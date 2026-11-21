// tests/unit/modules/schemas/kyc/maintainers/repositories/gender.repository.test.ts
//
// GenderRepository sobre Prisma (fase 0 de docs/prisma-migration.md): se mockea el cliente único y se
// verifica que el repositorio arma las consultas con los nombres de campo de Prisma (camelCase).

jest.mock('../../../shared/database/prisma', () => ({
  gender: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn() }
}));

import { mocked } from 'tests/helpers/mock';
import prismaModule from '../../../shared/database/prisma';
const prisma = mocked(prismaModule);
import genderRepository from './gender.repository';
import { page } from 'tests/helpers/page';

describe('GenderRepository (Prisma)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('findById busca por la PK genderId', async () => {
    const gender = { genderId: 'g-1', name: 'Femenino', isActive: true };
    prisma.gender.findUnique.mockResolvedValue(gender);

    await expect(genderRepository.findById('g-1')).resolves.toBe(gender);
    expect(prisma.gender.findUnique).toHaveBeenCalledWith({ where: { genderId: 'g-1' } });
  });

  it('exists cuenta con take: 1 y devuelve boolean', async () => {
    prisma.gender.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    await expect(genderRepository.exists({ genderId: 'g-1' })).resolves.toBe(true);
    await expect(genderRepository.exists({ genderId: 'nope' })).resolves.toBe(false);
    expect(prisma.gender.count).toHaveBeenCalledWith({ where: { genderId: 'g-1' }, take: 1 });
  });

  describe('findAllPaginated (mismo contrato que ReadRepository)', () => {
    it('filtra por isActive, busca sin distinguir mayúsculas y pagina', async () => {
      prisma.gender.findMany.mockResolvedValue([{ genderId: 'g-1' }]);
      prisma.gender.count.mockResolvedValue(1);

      const result = await genderRepository.findAllPaginated({ isActive: true }, page({ page: 3, sortBy: 'name', order: 'ASC' }), 'fem');

      const where = { isActive: true, OR: [{ name: { contains: 'fem', mode: 'insensitive' } }] };
      // desempate por la clave primaria: el orden es estable entre páginas
      expect(prisma.gender.findMany).toHaveBeenCalledWith({ where, take: 10, skip: 20, orderBy: [{ name: 'asc' }, { genderId: 'asc' }] });
      expect(prisma.gender.count).toHaveBeenCalledWith({ where });
      expect(result).toEqual({ rows: [{ genderId: 'g-1' }], count: 1 });
    });

    it('aplica el orden pedido tal cual (el esquema del request ya validó el campo)', async () => {
      prisma.gender.findMany.mockResolvedValue([]);
      prisma.gender.count.mockResolvedValue(0);

      await genderRepository.findAllPaginated({}, page());

      expect(prisma.gender.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {}, orderBy: [{ createdAt: 'desc' }, { genderId: 'desc' }] })
      );
    });
  });
});
