// Adaptador Prisma de las cuentas de usuario (puerto UserRepository). Cada lectura trae las relaciones que pide su
// flujo; la PII de persona y contacto llega descifrada (piiExtension) y el documento se filtra por su hash.
import PrismaRepository from '../../../../shared/infrastructure/database/prisma.repository';
import type { PageRequest } from '../../../../shared/application/pagination';
import type { Prisma } from '../../../../shared/infrastructure/database/generated/prisma/client';
import { hashValue } from '../../../../shared/infrastructure/database/pii-fields';
import type {
  AccountTarget,
  NewUserAccount,
  UserListFilters,
  UserRepository,
  UserWithContact
} from '../../application/ports/user-repository.port';
import type { AccountForDeletion, LoginUser, RoleRef, UserAccount, UserChanges, UserProfile, UserWithPhone } from '../../domain/user';

const PROFILE = {
  person: {
    include: {
      contact: { include: { phonePrimaryPrefix: true, phoneSecondaryPrefix: true } },
      gender: true,
      country: true,
      documentType: true,
      location: { include: { country: true, city: true, department: true } }
    }
  },
  role: true,
  avatar: true
} satisfies Prisma.UserInclude;

const WITH_CONTACT = { person: { include: { contact: true } } } satisfies Prisma.UserInclude;

/** Autenticación y login (person y role son obligatorias en el schema). */
const LOGIN = { ...WITH_CONTACT, role: true } satisfies Prisma.UserInclude;

/** Lo que necesitan las acciones de admin sobre una cuenta: nombre, documento, email y rol. */
const ADMIN_TARGET = {
  person: {
    select: {
      personId: true,
      firstName: true,
      nationalId: true,
      contact: { select: { personContactId: true, email: true } }
    }
  },
  role: { select: { roleId: true, name: true, description: true } }
} satisfies Prisma.UserInclude;

export class PrismaUserRepository extends PrismaRepository implements UserRepository {
  async findById(userId: string): Promise<UserAccount | null> {
    return (await this.db()).user.findUnique({ where: { userId } });
  }

  async findByPersonId(personId: string): Promise<UserAccount | null> {
    return (await this.db()).user.findUnique({ where: { personId } });
  }

  async findWithRole(userId: string): Promise<(UserAccount & { role: RoleRef | null }) | null> {
    return (await this.db()).user.findUnique({ where: { userId }, include: { role: true } });
  }

  async findLoginUser(userId: string): Promise<LoginUser | null> {
    return (await this.db()).user.findUnique({ where: { userId }, include: LOGIN });
  }

  async findLoginUserByNationalId(nationalId: string): Promise<LoginUser | null> {
    return (await this.db()).user.findFirst({ where: { person: { nationalIdHash: hashValue(nationalId) } }, include: LOGIN });
  }

  async findLoginUserByUsername(username: string): Promise<LoginUser | null> {
    return (await this.db()).user.findUnique({ where: { username }, include: LOGIN });
  }

  async findProfile(userId: string): Promise<UserProfile | null> {
    return (await this.db()).user.findUnique({ where: { userId }, include: PROFILE });
  }

  async findWithContact(userId: string): Promise<UserWithContact | null> {
    return (await this.db()).user.findUnique({ where: { userId }, include: WITH_CONTACT });
  }

  /** Con el teléfono principal de su contacto (SMS MFA). */
  async findWithPrimaryPhone(userId: string): Promise<UserWithPhone | null> {
    return (await this.db()).user.findUnique({
      where: { userId },
      include: { person: { select: { personId: true, contact: { select: { phonePrimary: true, phonePrimaryPrefixId: true } } } } }
    });
  }

  async findAdminTarget(userId: string): Promise<AccountTarget | null> {
    return (await this.db()).user.findUnique({ where: { userId }, include: ADMIN_TARGET });
  }

  /** Lo mínimo para ofuscar una cuenta al eliminarla: username + persona (documento, nombre) + email. */
  async findForAccountDeletion(userId: string): Promise<AccountForDeletion | null> {
    return (await this.db()).user.findUnique({
      where: { userId },
      select: {
        userId: true,
        username: true,
        person: {
          select: { personId: true, nationalId: true, firstName: true, contact: { select: { personContactId: true, email: true } } }
        }
      }
    });
  }

  /** Solo los flags de MFA (lectura ligera para el gate de 2FA en cada request). */
  async findMfaFlags(userId: string) {
    return (await this.db()).user.findUnique({ where: { userId }, select: { totpEnabled: true, smsMfaEnabled: true } });
  }

  async findActiveIdsByRoleNames(roleNames: readonly string[]): Promise<string[]> {
    const users = await (await this.db()).user.findMany({
      where: { isActive: true, role: { name: { in: [...roleNames] } } },
      select: { userId: true, person: false }
    });
    return users.map(user => user.userId);
  }

  async findActivePageByRoleNames(roleNames: readonly string[], afterUserId: string | null, limit: number): Promise<UserWithContact[]> {
    return (await this.db()).user.findMany({
      where: { isActive: true, role: { name: { in: [...roleNames] } }, ...(afterUserId ? { userId: { gt: afterUserId } } : {}) },
      include: WITH_CONTACT,
      orderBy: { userId: 'asc' },
      take: limit
    });
  }

  /** Listado paginado con el perfil, filtros y búsqueda por username / nombre. */
  async list(filters: UserListFilters = {}, pagination: PageRequest, searchTerm: string | null = null): Promise<{ rows: UserProfile[]; count: number }> {
    const and: Prisma.UserWhereInput[] = [];
    if (filters.isActive !== undefined) {
      and.push({ isActive: filters.isActive });
    }
    if (filters.roleIds?.length) {
      and.push({ roleId: { in: filters.roleIds } });
    }
    if (filters.nationalId) {
      and.push({ person: { nationalIdHash: hashValue(filters.nationalId) } });
    }
    // excludeUserId pisa a userId
    if (filters.excludeUserId) {
      and.push({ userId: { not: filters.excludeUserId } });
    } else if (filters.userId) {
      and.push({ userId: filters.userId });
    }
    // Eliminados (deleted_at): excluidos por defecto; onlyDeleted → solo ellos; includeDeleted → todos
    if (filters.onlyDeleted) {
      and.push({ deletedAt: { not: null } });
    } else if (!filters.includeDeleted) {
      and.push({ deletedAt: null });
    }
    // username, first_name y last_name no van cifrados; national_id y email sí (no se buscan por texto)
    if (searchTerm) {
      const contains = { contains: searchTerm, mode: 'insensitive' as const };
      and.push({ OR: [{ username: contains }, { person: { firstName: contains } }, { person: { lastName: contains } }] });
    }
    const where: Prisma.UserWhereInput = { AND: and };
    const db = await this.db();
    const [rows, count] = await Promise.all([
      db.user.findMany({ where, include: PROFILE, ...this.paginationArgs(pagination, 'userId') }),
      db.user.count({ where })
    ]);
    return { rows, count };
  }

  async create(account: NewUserAccount): Promise<UserAccount> {
    return (await this.db()).user.create({
      data: {
        username: account.username,
        passwordHash: account.passwordHash,
        personId: account.personId,
        roleId: account.roleId,
        avatarId: account.avatarId || null,
        authUsername: account.authUsername || null,
        isActive: true,
        totpEnabled: false,
        privacyPolicyVersion: account.privacyPolicyVersion || null,
        privacyPolicyAcceptedAt: account.privacyPolicyAcceptedAt || null,
        privacyPolicyAcceptedIp: account.privacyPolicyAcceptedIp || null
      }
    });
  }

  async update(userId: string, changes: UserChanges & { passwordHash?: string; avatarId?: string }): Promise<UserAccount | null> {
    const [row] = await (await this.db()).user.updateManyAndReturn({ where: { userId }, data: changes });
    return row ?? null;
  }
}
