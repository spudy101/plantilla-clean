// shared/services/rbac.service.ts
//
// ============================================================================
// RbacService — resolución de permisos del RBAC (RF-ADM-01)
// ============================================================================
//
// Único punto que responde "¿este rol puede hacer esta acción en este módulo?".
// El middleware y los controllers SIEMPRE preguntan aquí; nunca leen la matriz
// directamente.
//
// ─── Dos capas de permisos ────────────────────────────────────────────────────
//   1. MATRIZ BASE (código, inmutable) — ROLE_PERMISSIONS en shared/constants/rbac.js
//      Criterio #2: no editable en runtime. Solo cambia con un deploy.
//
//   2. OVERRIDES en BD (runtime, editables por SUPERADMIN) — tabla role_permission_overrides
//      Criterio #1: el SUPERADMIN define permisos adicionales por módulo (CRUD).
//      Los overrides SOLO AÑADEN permisos sobre la base; nunca la reducen.
//
// ─── Estrategia de caché ─────────────────────────────────────────────────────
//   Los overrides de cada rol se cachean en Redis (TTL 60s, key rbac:overrides:{roleName}).
//   Al otorgar o revocar un override, el servicio que gestiona esa operación
//   (AdminRbacService) invoca `invalidateCache(roleName)` para que el cambio
//   surta efecto de inmediato sin esperar los 60s.
//   Fail-open: si Redis no está disponible, se consulta BD directamente.

import { interopDefault } from '../../../shared/utils/interop.util';
import constantsModule from '../../../shared/constants';
const { RBAC_WILDCARD, RBAC_MODULES, RBAC_MODULE_GROUPS, RBAC_ACTIONS, ROLE_PERMISSIONS } = constantsModule;
import redisClient from '../../../shared/infra/redis.util';

const CACHE_TTL_SECONDS = 60;
// v2: los overrides pasaron a camelCase (moduleName) con Prisma; la clave nueva evita leer entradas viejas.
const CACHE_KEY_PREFIX = 'rbac:overrides:v2:';

import type rolePermissionOverrideRepositoryModule from '../repositories/role-permission-override.repository';
type RolePermissionOverrideRepositoryPort = typeof rolePermissionOverrideRepositoryModule;

/** Override de permiso en BD (role_permission_overrides): concede una acción extra sobre un módulo. */
interface PermissionOverride {
  moduleName: string;
  action: string;
}

/** Repositorio que RbacService necesita (lookup liviano de overrides por rol): solo ese método (ISP). */
type OverrideRepositoryPort = Pick<RolePermissionOverrideRepositoryPort, 'findLookupByRole'>;

type ModulePermission = string[] | string | undefined;

class RbacService {
  private _overrideRepository: OverrideRepositoryPort | null;

  /**
   * @param {object} [deps] Dependencias inyectables (SOLID: D). Sin overrideRepository se carga el
   *   repositorio real de forma perezosa (evita ciclos de carga al arrancar).
   */
  constructor(deps: { overrideRepository?: OverrideRepositoryPort } = {}) {
    this._overrideRepository = deps.overrideRepository ?? null;
  }

  get overrideRepository(): OverrideRepositoryPort {
    // require diferido: el repositorio vive en modules/ y cargarlo al importar crearía un ciclo
    this._overrideRepository ??= interopDefault(require('../repositories/role-permission-override.repository') as typeof import('../repositories/role-permission-override.repository')) as OverrideRepositoryPort;
    return this._overrideRepository;
  }

  // ============================================================
  // RESOLUCIÓN DE PERMISOS
  // ============================================================

  /**
   * ¿El rol puede ejecutar `action` sobre `moduleName`?
   *
   * Primero resuelve la base (código). Si la base concede el permiso, retorna
   * true sin consultar BD. Si no, consulta los overrides (con caché Redis).
   *
   * @param {string} roleName
   * @param {string} moduleName - uno de RBAC_MODULES
   * @param {string} action     - una de RBAC_ACTIONS
   * @returns {Promise<boolean>}
   */
  async can(roleName: string, moduleName: string, action: string): Promise<boolean> {
    const basePerms = ROLE_PERMISSIONS[roleName];

    if (!basePerms) {
      return false;
    }
    if (basePerms === RBAC_WILDCARD) {
      return true;
    }

    if (this._moduleAllows(basePerms[moduleName], action) || this._moduleAllows(basePerms[RBAC_WILDCARD], action)) {
      return true;
    }

    // La base no concede el permiso → revisar overrides en BD (con caché).
    const overrides = await this._loadOverrides(roleName);
    return overrides.some(o => o.moduleName === moduleName && o.action === action);
  }

  /**
   * ¿El rol tiene CUALQUIER acción sobre el módulo?
   * @param {string} roleName
   * @param {string} moduleName
   * @returns {Promise<boolean>}
   */
  async canAccessModule(roleName: string, moduleName: string): Promise<boolean> {
    for (const action of Object.values(RBAC_ACTIONS)) {
      if (await this.can(roleName, moduleName, action)) {
        return true;
      }
    }
    return false;
  }

  // ============================================================
  // CATÁLOGO (para que el front bloquee vistas)
  // ============================================================

  /**
   * Catálogo para que el front pinte el árbol de permisos y bloquee vistas.
   *   groups  — agrupaciones con labels en español: [{ key, label, modules: [{ id, label }] }]
   *   modules — lista plana de ids de módulo (compatibilidad)
   *   actions — acciones CRUD
   * @returns {{ groups: object[], modules: string[], actions: string[] }}
   */
  listCatalog() {
    return {
      groups: RBAC_MODULE_GROUPS,
      modules: Object.values(RBAC_MODULES),
      actions: Object.values(RBAC_ACTIONS)
    };
  }

  /**
   * Permisos efectivos de un rol, normalizados a { [modulo]: [acciones] }.
   * Carga los overrides UNA sola vez y resuelve el resto en memoria.
   *
   * @param {string} roleName
   * @returns {Promise<Object<string, string[]>>}
   */
  async getEffectivePermissions(roleName: string): Promise<Record<string, string[]>> {
    const modules = Object.values(RBAC_MODULES);
    const overrides = await this._loadOverrides(roleName);
    const result: Record<string, string[]> = {};

    for (const moduleName of modules) {
      const actions = Object.values(RBAC_ACTIONS).filter(action => this._canSync(roleName, moduleName, action, overrides));
      if (actions.length > 0) {
        result[moduleName] = actions;
      }
    }

    return result;
  }

  /**
   * Matriz de permisos para una lista de roles, diferenciando origen.
   *
   * Cada entrada retorna:
   *   basePermissions     — permisos definidos en ROLE_PERMISSIONS (código, inmutables)
   *   addedPermissions    — overrides agregados en runtime por SUPERADMIN (BD)
   *
   * El front puede mostrar los base como no editables y los added como revocables.
   *
   * @param {string[]} roleNames
   * @returns {Promise<Array<{ role, base_permissions, added_permissions }>>}
   */
  getRoleMatrix(roleNames: readonly string[] = []) {
    return Promise.all(roleNames.map(roleName => this._getRoleMatrixEntry(roleName)));
  }

  /** @private */
  async _getRoleMatrixEntry(roleName: string) {
    const modules = Object.values(RBAC_MODULES);
    const overrides = await this._loadOverrides(roleName);

    const basePermissions: Record<string, string[]> = {};
    const addedPermissions: Record<string, string[]> = {};

    for (const moduleName of modules) {
      const baseActions: string[] = [];
      const addedActions: string[] = [];

      for (const action of Object.values(RBAC_ACTIONS)) {
        const fromBase = this._comesFromBase(roleName, moduleName, action);
        const fromOverride = overrides.some(o => o.moduleName === moduleName && o.action === action);

        if (fromBase) {
          baseActions.push(action);
        }
        // Un override que ya está cubierto por la base no se repite en added
        else if (fromOverride) {
          addedActions.push(action);
        }
      }

      if (baseActions.length > 0) {
        basePermissions[moduleName] = baseActions;
      }
      if (addedActions.length > 0) {
        addedPermissions[moduleName] = addedActions;
      }
    }

    return {
      role: roleName,
      basePermissions,
      addedPermissions
    };
  }

  /**
   * Verifica si un permiso viene exclusivamente de la matriz base (código).
   * No consulta overrides — solo la constante ROLE_PERMISSIONS.
   * @private
   */
  _comesFromBase(roleName: string, moduleName: string, action: string): boolean {
    const basePerms = ROLE_PERMISSIONS[roleName];
    if (!basePerms) {
      return false;
    }
    if (basePerms === RBAC_WILDCARD) {
      return true;
    }
    return this._moduleAllows(basePerms[moduleName], action) || this._moduleAllows(basePerms[RBAC_WILDCARD], action);
  }

  // ============================================================
  // GESTIÓN DE CACHÉ (invocada por AdminRbacService)
  // ============================================================

  /** Invalida la caché de overrides de un rol. Llamar tras POST/DELETE de override. */
  async invalidateCache(roleName: string): Promise<void> {
    await redisClient.del(`${CACHE_KEY_PREFIX}${roleName}`);
  }

  // ============================================================
  // PRIVATE
  // ============================================================

  /**
   * Resolución síncrona cuando los overrides ya están cargados.
   * Evita consultas redundantes dentro de getEffectivePermissions.
   * @private
   */
  _canSync(roleName: string, moduleName: string, action: string, overrides: PermissionOverride[]): boolean {
    const basePerms = ROLE_PERMISSIONS[roleName];
    if (!basePerms) {
      return false;
    }
    if (basePerms === RBAC_WILDCARD) {
      return true;
    }
    if (this._moduleAllows(basePerms[moduleName], action) || this._moduleAllows(basePerms[RBAC_WILDCARD], action)) {
      return true;
    }
    return overrides.some(o => o.moduleName === moduleName && o.action === action);
  }

  /**
   * Carga los overrides de un rol desde caché Redis o BD.
   * Retorna array de { moduleName, action }.
   * @private
   */
  async _loadOverrides(roleName: string): Promise<PermissionOverride[]> {
    const cacheKey = `${CACHE_KEY_PREFIX}${roleName}`;

    const cached = await redisClient.get<PermissionOverride[]>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    const overrides = await this.overrideRepository.findLookupByRole(roleName);

    await redisClient.set(cacheKey, overrides, CACHE_TTL_SECONDS);

    return overrides;
  }

  /** @private */
  _moduleAllows(actions: ModulePermission, action: string): boolean {
    if (!actions) {
      return false;
    }
    return actions === RBAC_WILDCARD || actions.includes(action);
  }
}

export default Object.assign(new RbacService(), { RbacService });
