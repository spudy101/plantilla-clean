// tests/unit/modules/schemas/notification/services/notification-cleanup.service.test.ts
//
// NotificationCleanupService — poda periódica de datos caducos. Probamos la lógica de valor, no el
// acceso a datos: (1) la ventana de retención por defecto (90 días para notificaciones/tokens, 30
// para códigos) se propaga a los repos; (2) un valor de retención explícito se respeta; (3) los
// conteos devueltos agregan lo que reportan los repos con las claves esperadas; (4) los códigos de
// verificación se limpian en dos pasos (expirados sin ventana + verificados con ventana); (5) el
// camino de error de limpiarNotificacionesAntiguas registra un warn y re-propaga. Repos y logger se
// mockean para aislar la lógica.

jest.mock('../repositories/notification.repository', () => ({
  deleteOldRead: jest.fn()
}));

jest.mock('../repositories/user-push-token.repository', () => ({
  deleteOldInactive: jest.fn()
}));

jest.mock('../repositories/verification-code.repository', () => ({
  deleteExpired: jest.fn(),
  deleteOldVerified: jest.fn()
}));

jest.mock('../../../shared/infrastructure/observability/logger.util', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
  logAudit: jest.fn()
}));
jest.mock('../../audit/audit.service', () => ({ record: jest.fn() }));

import { mocked } from 'tests/helpers/mock';
import notificationRepoModule from '../repositories/notification.repository';
const notificationRepo = mocked(notificationRepoModule);
import userPushTokenRepoModule from '../repositories/user-push-token.repository';
const userPushTokenRepo = mocked(userPushTokenRepoModule);
import verificationCodeRepoModule from '../repositories/verification-code.repository';
const verificationCodeRepo = mocked(verificationCodeRepoModule);
import loggerUtilModule from '../../../shared/infrastructure/observability/logger.util';
const { logger } = mocked(loggerUtilModule);
import cleanup from './notification-cleanup.service';

describe('NotificationCleanupService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('limpiarNotificacionesAntiguas', () => {
    it('usa la ventana por defecto de 90 días y agrega los conteos de ambos repos', async () => {
      notificationRepo.deleteOldRead.mockResolvedValue(7);
      userPushTokenRepo.deleteOldInactive.mockResolvedValue(3);

      const result = await cleanup.limpiarNotificacionesAntiguas();

      // Sin argumento explícito, la ventana por defecto es 90 en ambos repos.
      expect(notificationRepo.deleteOldRead).toHaveBeenCalledWith(90);
      expect(userPushTokenRepo.deleteOldInactive).toHaveBeenCalledWith(90);
      expect(result).toEqual({ notificacionesEliminadas: 7, tokensEliminados: 3 });
    });

    it('propaga la ventana explícita a ambos repos', async () => {
      notificationRepo.deleteOldRead.mockResolvedValue(0);
      userPushTokenRepo.deleteOldInactive.mockResolvedValue(0);

      const result = await cleanup.limpiarNotificacionesAntiguas(30);

      expect(notificationRepo.deleteOldRead).toHaveBeenCalledWith(30);
      expect(userPushTokenRepo.deleteOldInactive).toHaveBeenCalledWith(30);
      expect(result).toEqual({ notificacionesEliminadas: 0, tokensEliminados: 0 });
    });

    it('registra un warn y re-propaga si un repo falla', async () => {
      notificationRepo.deleteOldRead.mockRejectedValue(new Error('db down'));

      await expect(cleanup.limpiarNotificacionesAntiguas()).rejects.toThrow('db down');
      expect(logger.warn).toHaveBeenCalledWith('Error en limpieza', { error: 'db down' });
      // Al fallar el primer paso, la limpieza de tokens no llega a ejecutarse.
      expect(userPushTokenRepo.deleteOldInactive).not.toHaveBeenCalled();
    });
  });

  describe('limpiarCodigosVerificacion', () => {
    it('limpia en dos pasos: expirados (sin ventana) + verificados con la ventana por defecto de 30 días', async () => {
      verificationCodeRepo.deleteExpired.mockResolvedValue(5);
      verificationCodeRepo.deleteOldVerified.mockResolvedValue(2);

      const result = await cleanup.limpiarCodigosVerificacion();

      // deleteExpired no depende de la ventana de retención; deleteOldVerified sí.
      expect(verificationCodeRepo.deleteExpired).toHaveBeenCalledWith();
      expect(verificationCodeRepo.deleteOldVerified).toHaveBeenCalledWith(30);
      expect(result).toEqual({ expiradosEliminados: 5, verificadosEliminados: 2 });
    });

    it('respeta la ventana de retención explícita para los verificados', async () => {
      verificationCodeRepo.deleteExpired.mockResolvedValue(0);
      verificationCodeRepo.deleteOldVerified.mockResolvedValue(9);

      const result = await cleanup.limpiarCodigosVerificacion(7);

      // La ventana sólo afecta a los verificados; los expirados se borran igual.
      expect(verificationCodeRepo.deleteExpired).toHaveBeenCalledWith();
      expect(verificationCodeRepo.deleteOldVerified).toHaveBeenCalledWith(7);
      expect(result).toEqual({ expiradosEliminados: 0, verificadosEliminados: 9 });
    });
  });
});
