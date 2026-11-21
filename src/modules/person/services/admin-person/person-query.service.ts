// modules/admin/kyc/person/services/admin-person/person-query.service.ts
//
// Consultas de cuentas de cliente para el panel admin: listado, eliminados,
// opciones de rol y detalle. Extraído de PersonService (SOLID: S).

import iamModule from '../../../iam';
const { userRepository, roleRepository } = iamModule;
type UserRepositoryPort = (typeof iamModule)['userRepository'];
import AppError from '../../../../shared/http/app-error.util';
import constantsModule from '../../../../shared/constants';
const { CLIENT_ROLE_NAMES } = constantsModule;

import adminPersonDtoModule from '../../responses/admin-person.response';
const { UserDTO, UserListItemDTO, RoleOptionDTO } = adminPersonDtoModule;
import auditModule from '../../../audit';
import { pageOf, pageRequest } from '../../../../shared/http/pagination';
import type { DeletedPersonListQuery, PersonListQuery } from '../../requests/person.request';
const { audit } = auditModule;

class PersonQueryService {
  userRepository: typeof userRepository;
  roleRepository: typeof roleRepository;

  /**
   * @param {object} [deps] Dependencias inyectables (SOLID: D). Las provee la fachada
   *   PersonService; por defecto se usan las implementaciones reales.
   */
  constructor(deps: PersonQueryService.Deps = {}) {
    this.userRepository = deps.userRepository ?? userRepository;
    this.roleRepository = deps.roleRepository ?? roleRepository;
  }

  // ============================================================
  // CONSULTAS
  // ============================================================

  async list(query: PersonListQuery, adminUserId: string) {
    const page = pageRequest(query);
    const filters: NonNullable<Parameters<UserRepositoryPort['findAllPaginated']>[0]> = { isActive: query.isActive ?? undefined };

    // El listado de clientes SOLO muestra usuarios con rol CLIENTE o CLIENTE_VERIFICADO
    // (espejo de admin-user.service, que se limita a INTERNAL_ROLE_NAMES). Si llega roleId,
    // se intersecta con los roles cliente; si no queda ninguno válido, se listan todos los
    // roles cliente. Así el endpoint nunca expone usuarios internos ni entidades externas.
    const clientRoleIds = await this._clientRoleIds();
    let roleIds = clientRoleIds;
    if (query.roleId) {
      const requested = String(query.roleId)
        .split(',')
        .map(id => id.trim());
      const valid = requested.filter(id => clientRoleIds.includes(id));
      if (valid.length) {
        roleIds = valid;
      }
    }
    filters.roleIds = roleIds;

    // nationalId se busca por hash exacto (el campo está cifrado con IV aleatorio)
    if (query.nationalId) {
      filters.nationalId = query.nationalId;
    }

    // userId filtra por el PK exacto del usuario
    if (query.userId) {
      filters.userId = query.userId;
    }

    const { rows, count } = await this.userRepository.findAllPaginated(filters, page, query.search ?? null);

    await audit.record('PERSON_LIST_VIEWED', {
      actorId: adminUserId,
      details: {
        totalItems: count,
        page: page.page
      },
      entityType: 'User',
      entityTable: 'users'
    });

    // En la metadata, los filtros que pidió el cliente (el nationalId no se devuelve: es PII)
    return pageOf(
      rows.map(u => UserListItemDTO(u)),
      page,
      count,
      { search: query.search, roleId: query.roleId, userId: query.userId, isActive: query.isActive }
    );
  }

  /** @private — IDs de los roles de cliente (CLIENTE, CLIENTE_VERIFICADO) */
  async _clientRoleIds() {
    const roles = await this.roleRepository.findByNames(CLIENT_ROLE_NAMES);
    return roles.map(r => r.roleId);
  }

  /**
   * Listado HISTÓRICO de clientes eliminados (read-only). Solo cuentas con deleted_at != null.
   * El listado normal (list) las excluye; estas cuentas son intocables (no se modifican).
   */
  async listDeleted(query: DeletedPersonListQuery, adminUserId: string) {
    const page = pageRequest(query);

    const clientRoleIds = await this._clientRoleIds();
    const filters = { roleIds: clientRoleIds, onlyDeleted: true };

    const { rows, count } = await this.userRepository.findAllPaginated(filters, page, query.search ?? null);

    await audit.record('PERSON_DELETED_LIST_VIEWED', {
      actorId: adminUserId,
      details: { totalItems: count, page: page.page },
      entityType: 'User',
      entityTable: 'users'
    });

    return pageOf(rows.map(u => UserListItemDTO(u)), page, count, { search: query.search });
  }

  /**
   * Catálogo de roles de CLIENTE para poblar el filtro por rol del listado de clientes.
   * Devuelve solo los roles cliente (CLIENTE / CLIENTE_VERIFICADO) — los mismos que filtra `list`.
   * Evita que el front ofrezca todos los roles del sistema en este listado.
   */
  async listRoleOptions(adminUserId: string) {
    const roles = await this.roleRepository.findByNames(CLIENT_ROLE_NAMES);
    await audit.record('PERSON_ROLE_OPTIONS_VIEWED', {
      actorId: adminUserId,
      details: { totalItems: roles.length },
      entityType: 'RbacRole',
      entityTable: 'roles'
    });
    return roles.map(RoleOptionDTO);
  }

  async getById(userId: string, adminUserId: string) {
    const user = await this.userRepository.findByUserId(userId, 'full');
    if (!user) {
      throw AppError.notFound('Usuario no encontrado');
    }

    await audit.record('PERSON_VIEWED', {
      actorId: adminUserId,
      details: { targetUserId: userId },
      entityId: userId,
      entityType: 'User',
      entityTable: 'users'
    });

    return UserDTO(user);
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace PersonQueryService {
  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    userRepository?: typeof userRepository;
    roleRepository?: typeof roleRepository;
  }
}

export default PersonQueryService;
