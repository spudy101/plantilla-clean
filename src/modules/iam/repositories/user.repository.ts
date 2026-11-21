// modules/schemas/kyc/iam/repositories/user.repository.ts
//
// Usuarios. Las lecturas con perfil usan los niveles de UserRepository.INCLUDES (mismas relaciones que
// con Sequelize). La PII de persona y contacto llega descifrada (piiExtension); se filtra por su hash.
import bcrypt from 'bcryptjs';
import PrismaRepository from '../../../shared/database/prisma.repository';
import type { PageRequest } from '../../../shared/http/pagination';
import { Prisma } from '../../../shared/database/generated/prisma/client';
import type { User } from '../../../shared/database/generated/prisma/client';
import { hashValue } from '../../../shared/database/pii-fields';
import AppError from '../../../shared/http/app-error.util';

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

const INCLUDES = {
  /** Perfil completo. */
  full: PROFILE,
  /** Perfil básico (hoy, las mismas relaciones que full). */
  basic: PROFILE,
  /** Autenticación. */
  auth: { ...WITH_CONTACT, role: true },
  /** Login (person y role son obligatorias en el schema: el INNER JOIN de antes no cambia nada). */
  login: { ...WITH_CONTACT, role: true },
  /** Mínimo indispensable. */
  minimal: WITH_CONTACT
} as const satisfies Record<string, Prisma.UserInclude>;

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


export type UserIncludeLevel = keyof typeof INCLUDES;
export type UserWith<L extends UserIncludeLevel> = Prisma.UserGetPayload<{ include: (typeof INCLUDES)[L] }>;
/** Usuario con su perfil (niveles full/basic). */
export type UserProfileRow = UserWith<'basic'>;
export type UserAdminTargetRow = Prisma.UserGetPayload<{ include: typeof ADMIN_TARGET }>;

class UserRepository extends PrismaRepository {
  static readonly INCLUDES = INCLUDES;

  async findById(userId: string): Promise<User | null> {
    return (await this.db()).user.findUnique({ where: { userId } });
  }

  async findByIdWithRole(userId: string) {
    return (await this.db()).user.findUnique({ where: { userId }, include: { role: true } });
  }

  /** Cuenta con nombre, documento, email y rol (acciones de admin sobre un usuario). */
  async findAdminTarget(userId: string): Promise<UserAdminTargetRow | null> {
    return (await this.db()).user.findUnique({ where: { userId }, include: ADMIN_TARGET });
  }

  /** Lo mínimo para ofuscar una cuenta al eliminarla: username + persona (documento, nombre) + email. */
  async findForAccountDeletion(userId: string) {
    return (await this.db()).user.findUnique({
      where: { userId },
      select: {
        userId: true,
        username: true,
        person: {
          select: {
            personId: true,
            nationalId: true,
            firstName: true,
            contact: { select: { personContactId: true, email: true } }
          }
        }
      }
    });
  }

  /** Usuario con el teléfono principal de su contacto (SMS MFA). */
  async findWithPrimaryPhone(userId: string) {
    return (await this.db()).user.findUnique({
      where: { userId },
      include: { person: { select: { personId: true, contact: { select: { phonePrimary: true, phonePrimaryPrefixId: true } } } } }
    });
  }

  /** Solo los flags de MFA (lectura ligera para el gate de 2FA en cada request). */
  async findMfaFlags(userId: string) {
    return (await this.db()).user.findUnique({ where: { userId }, select: { totpEnabled: true, smsMfaEnabled: true } });
  }

  async findByUsername<L extends UserIncludeLevel = 'login'>(
    username: string,
    includeLevel: L = 'login' as L
  ): Promise<UserWith<L> | null> {
    return (await this.db()).user.findUnique({
      where: { username },
      include: INCLUDES[includeLevel]
    }) as Promise<UserWith<L> | null>;
  }

  async findByUserId<L extends UserIncludeLevel = 'basic'>(
    userId: string,
    includeLevel: L = 'basic' as L
  ): Promise<UserWith<L> | null> {
    return (await this.db()).user.findUnique({
      where: { userId },
      include: INCLUDES[includeLevel]
    }) as Promise<UserWith<L> | null>;
  }

  /** Usuario por documento (national_id va cifrado: se busca por su hash). */
  async findByUsernameAndNationalId<L extends UserIncludeLevel = 'login'>(
    nationalId: string,
    includeLevel: L = 'login' as L
  ): Promise<UserWith<L> | null> {
    return (await this.db()).user.findFirst({
      where: { person: { nationalIdHash: hashValue(nationalId) } },
      include: INCLUDES[includeLevel]
    }) as Promise<UserWith<L> | null>;
  }

  /**
   * Usuarios activos cuyo rol está en roleNames. Fuente única para notificar a colectivos por rol
   * (superadmins, Oficial de Cumplimiento…). `includePerson` agrega nombre y email.
   */
  async findActiveUsersByRoleNames(roleNames: readonly string[], { includePerson = false }: { includePerson?: boolean } = {}) {
    return (await this.db()).user.findMany({
      where: { isActive: true, role: { name: { in: [...roleNames] } } },
      select: {
        userId: true,
        person: includePerson
          ? { select: { personId: true, firstName: true, lastName: true, contact: { select: { email: true } } } }
          : false
      }
    });
  }

  /**
   * Una página de usuarios activos cuyo rol está en roleNames, ordenados por user_id y a partir del
   * siguiente a `afterUserId`, con su contacto (envío masivo de notificaciones globales).
   */
  async findActivePageByRoleNames(roleNames: readonly string[], afterUserId: string | null, limit: number) {
    return (await this.db()).user.findMany({
      where: { isActive: true, role: { name: { in: [...roleNames] } }, ...(afterUserId ? { userId: { gt: afterUserId } } : {}) },
      include: INCLUDES.minimal,
      orderBy: { userId: 'asc' },
      take: limit
    });
  }

  /** Listado paginado con el perfil básico, filtros y búsqueda por username / nombre. */
  async findAllPaginated(
    filters: UserRepository.Filters = {},
    pagination: PageRequest,
    searchTerm: string | null = null
  ): Promise<PrismaRepository.Page<UserProfileRow>> {
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
    // excludeUserId pisa a userId (mismo criterio que antes)
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
      db.user.findMany({ where, include: INCLUDES.basic, ...this.paginationArgs(pagination, 'userId') }),
      db.user.count({ where })
    ]);
    return { rows, count };
  }

  async create(data: Prisma.UserUncheckedCreateInput): Promise<User> {
    return (await this.db()).user.create({ data });
  }

  /**
   * Alta con contraseña en claro: la hashea y crea el usuario. Método propio (no un override de create):
   * recibe password en vez de passwordHash.
   */
  async createWithPassword({ password, ...userData }: UserRepository.CreateInput): Promise<User> {
    const passwordHash = await this._hashPassword(password);
    return this.create({
      username: userData.username,
      passwordHash,
      personId: userData.personId,
      roleId: userData.roleId,
      avatarId: userData.avatarId || null,
      authUsername: userData.authUsername || null,
      isActive: true,
      totpEnabled: false,
      privacyPolicyVersion: userData.privacyPolicyVersion || null,
      privacyPolicyAcceptedAt: userData.privacyPolicyAcceptedAt || null,
      privacyPolicyAcceptedIp: userData.privacyPolicyAcceptedIp || null
    });
  }

  /** Actualiza por id; null si la fila no existe. */
  async update(userId: string, data: Prisma.UserUncheckedUpdateManyInput): Promise<User | null> {
    const [row] = await (await this.db()).user.updateManyAndReturn({ where: { userId }, data });
    return row ?? null;
  }

  async updatePassword(userId: string, newPassword: string): Promise<User | null> {
    return this.update(userId, { passwordHash: await this._hashPassword(newPassword) });
  }

  /** Compara con el hash guardado; sin hash (cuenta sin contraseña local) nunca coincide. */
  verifyPassword(plainPassword: string, hashedPassword: string | null): Promise<boolean> {
    return hashedPassword ? bcrypt.compare(plainPassword, hashedPassword) : Promise.resolve(false);
  }

  setActiveStatus(userId: string, isActive: boolean): Promise<User | null> {
    return this.update(userId, { isActive });
  }

  setTOTPStatus(userId: string, enabled: boolean, totpSecret: string | null = null): Promise<User | null> {
    return this.update(userId, { totpEnabled: enabled, totpSecret });
  }

  async updateTOTPStatus(userId: string, enabled: boolean): Promise<User> {
    const updated = await this.update(userId, { totpEnabled: enabled });
    if (!updated) {
      throw AppError.notFound('Usuario no encontrado');
    }
    return updated;
  }

  /** Registra la aceptación de una nueva versión de política de privacidad. */
  async updatePrivacyPolicy(
    userId: string,
    { version, acceptedAt, acceptedIp }: { version: string; acceptedAt: Date; acceptedIp: string | null }
  ): Promise<User> {
    const updated = await this.update(userId, {
      privacyPolicyVersion: version,
      privacyPolicyAcceptedAt: acceptedAt,
      privacyPolicyAcceptedIp: acceptedIp
    });
    if (!updated) {
      throw AppError.notFound('Usuario no encontrado');
    }
    return updated;
  }

  // [RF-AUTH-01] | CA-05 | bcrypt con rounds=10, salt único generado por bcrypt
  // (verifyPassword() usa bcrypt.compare timing-safe).
  // TODO [RF-AUTH-01][CA-05]: considerar mover BCRYPT_ROUNDS a variable de entorno.
  _hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace UserRepository {
  /** Nivel de includes de UserRepository.INCLUDES. */
  export type IncludeLevel = UserIncludeLevel;

  export type Filters = {
    isActive?: boolean;
    roleIds?: string[];
    nationalId?: string;
    userId?: string;
    excludeUserId?: string;
    onlyDeleted?: boolean;
    includeDeleted?: boolean;
  };

  /** Alta de usuario: la contraseña llega en claro y el repositorio la hashea. */
  export type CreateInput = Pick<
    Prisma.UserUncheckedCreateInput,
    | 'username'
    | 'personId'
    | 'roleId'
    | 'avatarId'
    | 'authUsername'
    | 'privacyPolicyVersion'
    | 'privacyPolicyAcceptedAt'
    | 'privacyPolicyAcceptedIp'
  > & { password: string };
}

export default new UserRepository();
