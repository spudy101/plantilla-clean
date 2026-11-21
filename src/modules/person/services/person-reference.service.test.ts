// tests/unit/modules/client/kyc/person/services/person-reference.service.test.ts
//
// PersonReferenceService — CRUD de referencias de una persona (máx. 5). Aislamos el servicio
// mockeando el repositorio, los DTOs, el logger de auditoría y el contexto de request. Probamos:
// list() mapea y audita; create() respeta el tope de 5 y persiste origen del contexto; update()
// lanza 404 si no existe y audita el antes/después; remove() lanza 404 si no existe y hace baja
// lógica (isActive:false). Los errores de negocio se verifican con .rejects (AppError real).

jest.mock('../../../shared/observability/logger.util', () => ({
  logAudit: jest.fn(),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));
jest.mock('../../audit/audit.service', () => ({ record: jest.fn() }));

jest.mock('../repositories/person-reference.repository', () => ({
  findAllByPersonId: jest.fn(),
  create: jest.fn(),
  findActiveById: jest.fn(),
  update: jest.fn()
}));

// DTOs a passthrough para no acoplar a la forma interna del componente compartido.
jest.mock('../responses/person-reference.response', () => ({
  PersonReferenceDTO: jest.fn(r => ({ dto: 'item', ...r })),
  PersonReferenceListDTO: jest.fn(r => ({ dto: 'list', ...r }))
}));

import { mocked, fixture } from 'tests/helpers/mock';
import referenceRepoModule from '../repositories/person-reference.repository';
const referenceRepo = mocked(referenceRepoModule);
import auditServiceModule from '../../audit/audit.service';
const logAudit = mocked(auditServiceModule).record;
import service from './person-reference.service';

const PERSON_ID = 'person-1';
const USER_ID = 'user-1';

describe('PersonReferenceService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('list', () => {
    it('devuelve las referencias mapeadas y audita con el conteo', async () => {
      referenceRepo.findAllByPersonId.mockResolvedValue([{ personReferenceId: 'r-1' }, { personReferenceId: 'r-2' }]);

      const result = await service.list(PERSON_ID, USER_ID);

      expect(referenceRepo.findAllByPersonId).toHaveBeenCalledWith(PERSON_ID);
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ dto: 'list', personReferenceId: 'r-1' });
      expect(logAudit).toHaveBeenCalledWith('PROFILE_REFERENCES_VIEWED', expect.objectContaining({ actorId: USER_ID, details: { count: 2 }, entityType: 'PersonReference' })
      );
    });
  });

  describe('create', () => {
    // El origen (originSessionId/originCorrelationId) lo estampa la extensión de Prisma, no el service
    it('crea la referencia y audita', async () => {
      referenceRepo.findAllByPersonId.mockResolvedValue([]);
      referenceRepo.create.mockResolvedValue({ personReferenceId: 'r-9', referenceName: 'Ana' });

      const data = { referenceName: 'Ana', referencePhone: '+56911112222', referenceType: 'family' };
      const result = await service.create(fixture(data), PERSON_ID, USER_ID);

      expect(referenceRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          personId: PERSON_ID,
          referenceName: 'Ana',
          referencePhone: '+56911112222',
          referenceType: 'family'
        })
      );
      expect(result).toMatchObject({ dto: 'item', personReferenceId: 'r-9' });
      expect(logAudit).toHaveBeenCalledWith('PROFILE_REFERENCE_CREATED', expect.objectContaining({ actorId: USER_ID, entityId: 'r-9', entityType: 'PersonReference' })
      );
    });

    it('lanza 400 si ya hay 5 referencias (tope alcanzado)', async () => {
      referenceRepo.findAllByPersonId.mockResolvedValue(Array.from({ length: 5 }, (_, i) => ({ personReferenceId: `r-${i}` })));

      await expect(service.create(fixture({}), PERSON_ID, USER_ID)).rejects.toMatchObject({ statusCode: 400 });
      expect(referenceRepo.create).not.toHaveBeenCalled();
      expect(logAudit).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('lanza 404 si la referencia no existe', async () => {
      referenceRepo.findActiveById.mockResolvedValue(null);

      await expect(service.update('r-1', {}, PERSON_ID, USER_ID)).rejects.toMatchObject({ statusCode: 404 });
      expect(referenceRepo.update).not.toHaveBeenCalled();
    });

    it('actualiza y audita el antes/después', async () => {
      referenceRepo.findActiveById.mockResolvedValue({
        referenceName: 'Ana',
        referencePhone: '+56911112222',
        referenceType: 'family'
      });
      referenceRepo.update.mockResolvedValue({ personReferenceId: 'r-1', referenceName: 'Ana María' });

      const data = { referenceName: 'Ana María' };
      const result = await service.update('r-1', data, PERSON_ID, USER_ID);

      expect(referenceRepo.update).toHaveBeenCalledWith('r-1', {
        referenceName: 'Ana María',
        referencePhone: undefined,
        referenceType: undefined
      });
      expect(result).toMatchObject({ dto: 'item', personReferenceId: 'r-1' });
      expect(logAudit).toHaveBeenCalledWith('PROFILE_REFERENCE_UPDATED', expect.objectContaining({ actorId: USER_ID, details: expect.objectContaining({
          before: expect.objectContaining({ referenceName: 'Ana' }),
          after: expect.objectContaining({ referenceName: 'Ana María' })
        }), entityId: 'r-1', entityType: 'PersonReference' })
      );
    });
  });

  describe('remove', () => {
    it('lanza 404 si la referencia no existe', async () => {
      referenceRepo.findActiveById.mockResolvedValue(null);

      await expect(service.remove('r-1', PERSON_ID, USER_ID)).rejects.toMatchObject({ statusCode: 404 });
      expect(referenceRepo.update).not.toHaveBeenCalled();
    });

    it('hace baja lógica (isActive:false) y audita', async () => {
      referenceRepo.findActiveById.mockResolvedValue({ personReferenceId: 'r-1' });
      referenceRepo.update.mockResolvedValue({});

      await service.remove('r-1', PERSON_ID, USER_ID);

      expect(referenceRepo.update).toHaveBeenCalledWith('r-1', { isActive: false });
      expect(logAudit).toHaveBeenCalledWith('PROFILE_REFERENCE_DELETED', expect.objectContaining({ actorId: USER_ID, entityId: 'r-1', entityType: 'PersonReference' })
      );
    });
  });
});
