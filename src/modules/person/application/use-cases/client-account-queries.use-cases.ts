// Consultas del panel de clientes: listado, eliminados (histórico), opciones de rol y detalle.
//
// El panel solo muestra cuentas con rol de cliente: los usuarios internos tienen su propio listado
// (admin-user) y no se exponen acá.
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import { pageOf, pageRequest } from '../../../../shared/application/pagination';
import rbacModule from '../../../../shared/domain/constants/rbac';
import type { AccountListFilters, ClientAccounts, RoleDirectory } from '../ports/client-accounts.port';
import { ROLE_AUDIT_ENTITY, USER_AUDIT_ENTITY, type ListQuery } from './person-audit';
import { toAccountDetailOutput, toAccountListItemOutput, toRoleOptionOutput } from '../dto/admin-person.output';
import { UserNotFoundError } from '../../domain/errors';

const { CLIENT_ROLE_NAMES } = rbacModule;

async function clientRoleIds(roles: RoleDirectory): Promise<string[]> {
  return (await roles.findByNames(CLIENT_ROLE_NAMES)).map(r => r.roleId);
}

export type ClientAccountListQuery = ListQuery & {
  /** Uno o varios ids de rol separados por coma. */
  roleId?: string;
  nationalId?: string;
  userId?: string;
  isActive?: boolean | null;
};

export class ListClientAccounts {
  constructor(
    private readonly accounts: ClientAccounts,
    private readonly roles: RoleDirectory,
    private readonly audit: AuditTrail
  ) {}

  async execute({ actorId, query }: { actorId: string; query: ClientAccountListQuery }) {
    const page = pageRequest(query);

    // Si llega roleId se intersecta con los roles de cliente; si no queda ninguno válido, van todos ellos.
    const allowed = await clientRoleIds(this.roles);
    const requested = query.roleId ? query.roleId.split(',').map(id => id.trim()).filter(id => allowed.includes(id)) : [];
    const filters: AccountListFilters = { isActive: query.isActive ?? undefined, roleIds: requested.length ? requested : allowed };
    // El documento va cifrado: se busca exacto (por su hash)
    if (query.nationalId) {
      filters.nationalId = query.nationalId;
    }
    if (query.userId) {
      filters.userId = query.userId;
    }

    const { rows, count } = await this.accounts.list(filters, page, query.search ?? null);

    await this.audit.record('PERSON_LIST_VIEWED', {
      actorId,
      details: { totalItems: count, page: page.page },
      ...USER_AUDIT_ENTITY
    });

    // En la metadata, los filtros que pidió el cliente (el documento no: es PII)
    return pageOf(rows.map(toAccountListItemOutput), page, count, {
      search: query.search,
      roleId: query.roleId,
      userId: query.userId,
      isActive: query.isActive
    });
  }
}

/** Histórico de clientes eliminados (solo lectura: estas cuentas son intocables). */
export class ListDeletedClientAccounts {
  constructor(
    private readonly accounts: ClientAccounts,
    private readonly roles: RoleDirectory,
    private readonly audit: AuditTrail
  ) {}

  async execute({ actorId, query }: { actorId: string; query: ListQuery }) {
    const page = pageRequest(query);
    const filters: AccountListFilters = { roleIds: await clientRoleIds(this.roles), onlyDeleted: true };
    const { rows, count } = await this.accounts.list(filters, page, query.search ?? null);

    await this.audit.record('PERSON_DELETED_LIST_VIEWED', {
      actorId,
      details: { totalItems: count, page: page.page },
      ...USER_AUDIT_ENTITY
    });

    return pageOf(rows.map(toAccountListItemOutput), page, count, { search: query.search });
  }
}

/** Los roles de cliente, para el filtro por rol del listado (no se ofrecen los roles internos). */
export class ListClientRoleOptions {
  constructor(
    private readonly roles: RoleDirectory,
    private readonly audit: AuditTrail
  ) {}

  async execute({ actorId }: { actorId: string }) {
    const roles = await this.roles.findByNames(CLIENT_ROLE_NAMES);
    await this.audit.record('PERSON_ROLE_OPTIONS_VIEWED', { actorId, details: { totalItems: roles.length }, ...ROLE_AUDIT_ENTITY });
    return roles.map(toRoleOptionOutput);
  }
}

export class GetClientAccount {
  constructor(
    private readonly accounts: ClientAccounts,
    private readonly audit: AuditTrail
  ) {}

  async execute({ actorId, userId }: { actorId: string; userId: string }) {
    const account = await this.accounts.findProfile(userId);
    if (!account) {
      throw new UserNotFoundError();
    }
    await this.audit.record('PERSON_VIEWED', { actorId, details: { targetUserId: userId }, entityId: userId, ...USER_AUDIT_ENTITY });
    return toAccountDetailOutput(account);
  }
}
