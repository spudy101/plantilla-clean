// tests/unit/modules/schemas/notification/services/email-suppression.service.test.ts
//
// EmailSuppressionService — suppression list de correo por rebotes duros (hard bounces). Probamos la
// lógica pura de valor, no el passthrough al repo: (1) normalización a email_hash en _toHash (correo
// plano → generateHash; hash SHA-256 ya calculado → se usa tal cual en minúsculas; vacío → null);
// (2) isSuppressed corta en seco cuando no hay hash; (3) registerHardBounce audita cada rebote y solo
// dispara el evento de bloqueo en la transición active → suppressed (no en rebotes posteriores ni si
// ya estaba suprimida); (4) lift audita found según exista el registro y enmascara el correo solo si
// se recibió en claro. Mockeamos el repo, la utilidad de hash/enmascarado y el logger para aislar.

jest.mock('../repositories/email-bounce-suppression.repository', () => ({
  isSuppressed: jest.fn(),
  registerHardBounce: jest.fn(),
  lift: jest.fn()
}));

jest.mock('../../../shared/security/encryption.util', () => ({
  generateHash: jest.fn().mockReturnValue('email-hash-de-prueba')
}));

jest.mock('../../../shared/security/masking.util', () => ({
  maskEmail: jest.fn().mockReturnValue('u***@e***.com')
}));

jest.mock('../../../shared/observability/logger.util', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
  logAudit: jest.fn()
}));
jest.mock('../../audit/audit.service', () => ({ record: jest.fn() }));

import { mocked } from 'tests/helpers/mock';
import suppressionRepoModule from '../repositories/email-bounce-suppression.repository';
const suppressionRepo = mocked(suppressionRepoModule);
import EncryptionUtilModule from '../../../shared/security/encryption.util';
const EncryptionUtil = mocked(EncryptionUtilModule);
import MaskingUtilModule from '../../../shared/security/masking.util';
const MaskingUtil = mocked(MaskingUtilModule);
import loggerUtilModule from '../../../shared/observability/logger.util';
import auditServiceModule from '../../audit/audit.service';
const { logger } = mocked(loggerUtilModule);
const logAudit = mocked(auditServiceModule).record;
import service from './email-suppression.service';

// Un SHA-256 válido: 64 chars hexadecimales (en mayúsculas para verificar que se normaliza a minúsculas).
const HASHED_EMAIL = 'A'.repeat(64);

describe('EmailSuppressionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    EncryptionUtil.generateHash.mockReturnValue('email-hash-de-prueba');
    MaskingUtil.maskEmail.mockReturnValue('u***@e***.com');
  });

  describe('isSuppressed — normalización de la clave', () => {
    it('devuelve false sin consultar el repo cuando el correo es vacío', async () => {
      await expect(service.isSuppressed('')).resolves.toBe(false);
      expect(EncryptionUtil.generateHash).not.toHaveBeenCalled();
      expect(suppressionRepo.isSuppressed).not.toHaveBeenCalled();
    });

    it('hashea un correo en claro (trim + minúsculas) y consulta el repo con el hash', async () => {
      suppressionRepo.isSuppressed.mockResolvedValue(true);

      await expect(service.isSuppressed('  User@Example.COM  ')).resolves.toBe(true);

      expect(EncryptionUtil.generateHash).toHaveBeenCalledWith('user@example.com');
      expect(suppressionRepo.isSuppressed).toHaveBeenCalledWith('email-hash-de-prueba');
    });

    it('usa un hash SHA-256 ya calculado tal cual (en minúsculas) sin volver a hashear', async () => {
      suppressionRepo.isSuppressed.mockResolvedValue(false);

      await expect(service.isSuppressed(HASHED_EMAIL)).resolves.toBe(false);

      expect(EncryptionUtil.generateHash).not.toHaveBeenCalled();
      expect(suppressionRepo.isSuppressed).toHaveBeenCalledWith('a'.repeat(64));
    });
  });

  describe('registerHardBounce', () => {
    it('devuelve null y no toca el repo si no hay correo ni hash', async () => {
      await expect(service.registerHardBounce({})).resolves.toBeNull();
      expect(suppressionRepo.registerHardBounce).not.toHaveBeenCalled();
      expect(logAudit).not.toHaveBeenCalled();
    });

    it('registra el rebote, audita EMAIL_HARD_BOUNCE_RECORDED y no dispara bloqueo si aún no supera el umbral', async () => {
      suppressionRepo.registerHardBounce.mockResolvedValue({ bounceCount: 1, suppressed: false, alreadySuppressed: false });

      const result = await service.registerHardBounce({ email: 'user@example.com', errorCode: 'Bounce', userId: 'u-1' });

      // El repo recibe el hash y el umbral de negocio (3).
      expect(suppressionRepo.registerHardBounce).toHaveBeenCalledWith(
        'email-hash-de-prueba',
        expect.objectContaining({ userId: 'u-1', errorCode: 'Bounce', threshold: 3 })
      );
      // Se audita el rebote con el correo enmascarado (se recibió en claro).
      expect(MaskingUtil.maskEmail).toHaveBeenCalledWith('user@example.com');
      expect(logAudit).toHaveBeenCalledTimes(1);
      expect(logAudit).toHaveBeenCalledWith('EMAIL_HARD_BOUNCE_RECORDED', expect.objectContaining({ actorId: 'system', details: expect.objectContaining({ bounceCount: 1, threshold: 3, maskedEmail: 'u***@e***.com' }), outcome: 'failure' })
      );
      // Sin bloqueo: no hay warn ni segundo evento de auditoría.
      expect(logger.warn).not.toHaveBeenCalled();
      expect(result).toEqual({ bounceCount: 1, suppressed: false, alreadySuppressed: false });
    });

    it('dispara el evento de bloqueo (warn + EMAIL_ADDRESS_SUPPRESSED) en la transición active → suppressed', async () => {
      suppressionRepo.registerHardBounce.mockResolvedValue({ bounceCount: 3, suppressed: true, alreadySuppressed: false });

      await service.registerHardBounce({ email: 'user@example.com', errorCode: 'Bounce' });

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logAudit).toHaveBeenCalledTimes(2);
      expect(logAudit).toHaveBeenNthCalledWith(2, 'EMAIL_ADDRESS_SUPPRESSED', expect.objectContaining({ actorId: 'system', details: expect.objectContaining({ bounceCount: 3, threshold: 3 }), outcome: 'failure' })
      );
    });

    it('no vuelve a disparar el bloqueo en rebotes posteriores a una dirección ya suprimida', async () => {
      suppressionRepo.registerHardBounce.mockResolvedValue({ bounceCount: 5, suppressed: true, alreadySuppressed: true });

      await service.registerHardBounce({ email: 'user@example.com' });

      expect(logger.warn).not.toHaveBeenCalled();
      // Solo el evento de rebote; no el de bloqueo.
      expect(logAudit).toHaveBeenCalledTimes(1);
      expect(logAudit).toHaveBeenCalledWith('EMAIL_HARD_BOUNCE_RECORDED', expect.objectContaining({ actorId: 'system' }));
    });

    it('acepta emailHash directo y no enmascara cuando no hay correo en claro', async () => {
      suppressionRepo.registerHardBounce.mockResolvedValue({ bounceCount: 1, suppressed: false, alreadySuppressed: false });

      await service.registerHardBounce({ emailHash: HASHED_EMAIL });

      // El hash ya calculado se usa tal cual (minúsculas); no se rehashea.
      expect(EncryptionUtil.generateHash).not.toHaveBeenCalled();
      expect(suppressionRepo.registerHardBounce).toHaveBeenCalledWith('a'.repeat(64), expect.any(Object));
      // Sin correo en claro no hay enmascarado; maskedEmail queda null.
      expect(MaskingUtil.maskEmail).not.toHaveBeenCalled();
      expect(logAudit).toHaveBeenCalledWith('EMAIL_HARD_BOUNCE_RECORDED', expect.objectContaining({ actorId: 'system', details: expect.objectContaining({ maskedEmail: null }) })
      );
    });
  });

  describe('lift', () => {
    it('levanta la supresión y audita found:true cuando el registro existe', async () => {
      const record = { email_bounce_suppression_id: 'ebs-1' };
      suppressionRepo.lift.mockResolvedValue(record);

      const result = await service.lift({ email: 'user@example.com', adminUserId: 'admin-1' });

      expect(suppressionRepo.lift).toHaveBeenCalledWith('email-hash-de-prueba');
      expect(logAudit).toHaveBeenCalledWith('EMAIL_SUPPRESSION_LIFTED', expect.objectContaining({ actorId: 'admin-1', details: expect.objectContaining({ found: true, maskedEmail: 'u***@e***.com' }) })
      );
      expect(result).toBe(record);
    });

    it('audita found:false cuando no había registro que levantar', async () => {
      suppressionRepo.lift.mockResolvedValue(null);

      const result = await service.lift({ emailHash: HASHED_EMAIL, adminUserId: 'admin-2' });

      expect(suppressionRepo.lift).toHaveBeenCalledWith('a'.repeat(64));
      // Sin correo en claro no se enmascara.
      expect(MaskingUtil.maskEmail).not.toHaveBeenCalled();
      expect(logAudit).toHaveBeenCalledWith('EMAIL_SUPPRESSION_LIFTED', expect.objectContaining({ actorId: 'admin-2', details: expect.objectContaining({ found: false, maskedEmail: null }) })
      );
      expect(result).toBeNull();
    });
  });
});
