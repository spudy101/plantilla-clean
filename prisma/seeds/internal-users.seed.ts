// prisma/seeds/internal-users.seed.ts
//
// Usuarios internos base:
//   - SUPERADMIN, con las credenciales de SEED_ADMIN_* (obligatorias).
//   - ADMIN demo: segundo usuario interno para probar la doble aprobación (maker-checker) con dos
//     usuarios distintos; credenciales demo, misma password del admin.
// Se busca por el hash del email: si ya existe, no se toca. Persona, contacto y usuario se crean en una
// sola escritura anidada (atómica). El email y la cédula van en claro: la extensión de PII del cliente
// los cifra y calcula sus hashes (shared/database/pii-fields.ts).
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import constantsModule from '../../src/shared/infrastructure/config';
import { hashValue } from '../../src/shared/infrastructure/database/pii-fields';
import { report, type SeedClient } from './seed-client';

const { seeds, RBAC_ROLES } = constantsModule;

const BCRYPT_ROUNDS = 10;

interface InternalUserSeed {
  email: string;
  firstName: string;
  lastName: string;
  nationalId: string;
  password: string;
  roleName: string;
}

function internalUsers(): InternalUserSeed[] {
  const missing = [!seeds.adminEmail && 'SEED_ADMIN_EMAIL', !seeds.adminPassword && 'SEED_ADMIN_PASSWORD'].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`Faltan variables de entorno para el seed de usuarios internos: ${missing.join(', ')}`);
  }
  const password = seeds.adminPassword as string;
  return [
    {
      email: seeds.adminEmail as string,
      firstName: seeds.adminFirstName || 'Admin',
      lastName: seeds.adminLastName || 'Sistema',
      nationalId: seeds.adminNationalId || 'Admin',
      password,
      roleName: RBAC_ROLES.SUPERADMIN
    },
    {
      email: 'admin2@base-project.test',
      firstName: 'Admin',
      lastName: 'Secundario',
      nationalId: 'Admin2',
      password,
      roleName: RBAC_ROLES.ADMIN
    }
  ];
}

async function createInternalUser(db: SeedClient, seed: InternalUserSeed): Promise<void> {
  const existing = await db.personContact.findFirst({ where: { emailHash: hashValue(seed.email) }, select: { personId: true } });
  if (existing) {
    report(`Usuario ${seed.roleName} (${seed.email}): ya existía`);
    return;
  }

  const role = await db.role.findUnique({ where: { name: seed.roleName }, select: { roleId: true } });
  if (!role) {
    throw new Error(`Rol "${seed.roleName}" no encontrado: el seed de catálogos debe correr antes`);
  }
  const systemDocType = await db.documentType.findUnique({ where: { code: 'SYSTEM' }, select: { documentTypeId: true } });
  if (!systemDocType) {
    throw new Error('Tipo de documento SYSTEM no encontrado: el seed de catálogos debe correr antes');
  }

  const person = await db.person.create({
    data: {
      firstName: seed.firstName,
      lastName: seed.lastName,
      middleName: '',
      secondLastName: '',
      nationalId: seed.nationalId,
      documentTypeId: systemDocType.documentTypeId,
      contact: { create: { email: seed.email, emailVerifiedAt: new Date() } },
      user: {
        create: {
          // username en claro: se usa para el login
          username: seed.nationalId,
          passwordHash: await bcrypt.hash(seed.password, BCRYPT_ROUNDS),
          authUsername: `user_${randomUUID()}`,
          roleId: role.roleId,
          totpEnabled: false,
          isActive: true
        }
      }
    },
    select: { user: { select: { userId: true } } }
  });

  report(`Usuario ${seed.roleName} creado — email ${seed.email}, username ${seed.nationalId}, user_id ${person.user?.userId}`);
  report('  La password es la de SEED_ADMIN_PASSWORD: cámbiala en el primer login.');
}

export async function seedInternalUsers(db: SeedClient): Promise<void> {
  for (const seed of internalUsers()) {
    await createInternalUser(db, seed);
  }
}
