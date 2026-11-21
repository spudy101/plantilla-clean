// Core del framework de doble aprobación global (maker-checker / cuatro ojos).
//
// Tres responsabilidades:
//   1. register(opKey, handler) — cada módulo registra su "reanudación" (IoC). Al aprobar,
//      resolve() invoca ese handler con el payload guardado. NO se re-ejecutan requests HTTP.
//   2. gate(opKey, {...}) — decide si una operación requiere segunda aprobación; si la requiere
//      crea el approval_request (status=pending) y notifica a los aprobadores
//      (los avisos viven en dual-approval/dual-approval-notifier.service.js).
//   3. resolve(requestId, decision, ctx) — el segundo funcionario aprueba/rechaza; al aprobar
//      invoca el handler registrado y persiste el resultado.
//
// El "estado doble aprobación" de cualquier módulo vive en `approval_requests` — no se duplican
// columnas ni máquina de estados por tabla.

import { interopDefault } from '../../../shared/utils/interop.util';
import AppError from '../../../shared/http/app-error.util';
import loggerUtilModule from '../../../shared/observability/logger.util';
const { logger } = loggerUtilModule;
import businessHoursUtilModule from '../utils/business-hours.util';
const { addBusinessHours } = businessHoursUtilModule;
import approvalRequestRepository from '../repositories/approval-request.repository';
import iamModule from '../../iam';
const { userRepository } = iamModule;
import notificationModule from '../../notification';
const { notifier: notifications } = notificationModule;
import DualApprovalNotifierService from './dual-approval/dual-approval-notifier.service';
import domainEnumsModule from '../../../shared/constants/domain-enums';
const { APPROVAL_REQUEST_STATUS } = domainEnumsModule;
import dualApprovalModule from '../../../shared/constants/dual-approval';
import type DualApprovalConstants from '../../../shared/constants/dual-approval';
import type settingsModule from '../../settings';
type SystemGlobalConfigRepositoryPort = (typeof settingsModule)['systemGlobalConfigRepository'];
const { WILDCARD_ROLES, CONDITION, DEFAULT_TTL_HOURS, DUAL_APPROVAL_OPS } = dualApprovalModule;
import rbacModule from '../../../shared/constants/rbac';
const { SUPERADMIN_ROLE_NAMES } = rbacModule;
import componentsApprovalDtoModule from '../responses/approval-components.response';
const { ApprovalRequestComponent, PendingApprovalComponent } = componentsApprovalDtoModule;
import errorMessageModule from '../../../shared/utils/error-message.util';
import type { AdminAuditContext } from '../../../shared/types/audit-context';
import type { ApprovalRequest, Prisma } from '../../../shared/database/generated/prisma/client';

const { errorMessage } = errorMessageModule;
import auditModule from '../../audit';
import { pageOf, pageRequest } from '../../../shared/http/pagination';
import type { ApprovalListQuery } from '../requests/approval-request.request';
const { audit } = auditModule;


const DECISION = { APPROVE: 'approve', REJECT: 'reject' } as const;
const AUTO_APPROVE_NOTE = 'Auto-aprobado por super_admin (cuatro ojos omitido por rol)';

// Registro de handlers (IoC). Cada módulo registra su reanudación en el bootstrap.
const HANDLERS = new Map<string, { onApprove: DualApprovalService.Handler; onReject: DualApprovalService.Handler | null }>();

class DualApprovalService {
  approvalRequestRepository: typeof approvalRequestRepository;
  userRepository: typeof userRepository;
  notifications: typeof notifications;
  notifier: DualApprovalService.Notifier;

  /**
   * Dependencias inyectables (SOLID: D). Por defecto se usan las implementaciones
   * reales; en tests u otros contextos se pueden reemplazar:
   *   new DualApprovalService({ approvalRequestRepository: fake })
   * @param {object} [deps]
   */
  constructor(deps: DualApprovalService.Deps = {}) {
    this.approvalRequestRepository = deps.approvalRequestRepository ?? approvalRequestRepository;
    this.userRepository = deps.userRepository ?? userRepository;
    this.notifications = deps.notifications ?? notifications;
    // Avisos a aprobadores / solicitante (SOLID: S)
    this.notifier =
      deps.notifier ??
      new DualApprovalNotifierService({
        userRepository: this.userRepository,
        notifier: this.notifications
      });
  }

  // ── Registro de handlers ──────────────────────────────────────────────────

  /**
   * @param {string} opKey
   * @param {(payload, ctx)=>Promise<any>} onApprove — ejecuta la acción real al aprobar.
   * @param {(payload, ctx)=>Promise<any>} [onReject] — opcional: reacción al rechazo (ej: revertir
   *        un estado provisional). Si se omite, el rechazo solo marca el approval_request.
   */
  // eslint-disable-next-line class-methods-use-this
  // P: forma del payload que guardó la operación (cada handler declara la suya)
  register<P>(
    opKey: string,
    onApprove: DualApprovalService.Handler<P>,
    onReject: DualApprovalService.Handler<P> | null = null
  ) {
    if (!_findOp(opKey)) {
      throw new Error(`[DualApproval] Operación desconocida al registrar handler: ${opKey}`);
    }
    if (typeof onApprove !== 'function') {
      throw new Error(`[DualApproval] Handler inválido para ${opKey}`);
    }
    if (onReject !== null && typeof onReject !== 'function') {
      throw new Error(`[DualApproval] onReject inválido para ${opKey}`);
    }
    // El Map guarda handlers de payload desconocido: el tipo P solo vive en el call-site
    HANDLERS.set(opKey, { onApprove: onApprove as DualApprovalService.Handler, onReject: onReject as DualApprovalService.Handler | null });
  }

  // ── Condición de gate ───────────────────────────────────────────────────────

  async requiresApproval(opKey: string, payload: unknown) {
    // El maker-checker es incondicional: no hay interruptor global que lo apague. Cada operación
    // decide por su `condition` (ALWAYS o THRESHOLD sobre un campo del payload).
    const op = _getOp(opKey);
    if (op.condition === CONDITION.ALWAYS) {
      return true;
    }
    if (op.condition === CONDITION.THRESHOLD) {
      const value = Number((payload as Record<string, unknown> | null | undefined)?.[op.thresholdField ?? ''] ?? 0);
      const threshold = await _resolveThreshold(op);
      return value > threshold;
    }
    return false;
  }

  // ── Gate ─────────────────────────────────────────────────────────────────────

  /**
   * @param {string} opKey
   * @param {Object} args — { entityType?, entityId?, payload, ctx }
   * @returns {Promise<{pending:boolean, request?:Object}>}
   */
  async gate(opKey: string, { entityType, entityId, payload, ctx }: DualApprovalService.GateArgs) {
    const op = _getOp(opKey);

    const requires = await this.requiresApproval(opKey, payload);
    if (!requires) {
      return { pending: false };
    }

    const resolvedEntityType = entityType ?? op.entityType ?? null;

    // Una sola pendiente por (operación, entidad) — refuerza el índice único parcial.
    if (resolvedEntityType && entityId) {
      const existing = await this.approvalRequestRepository.findPendingByEntityOperation(opKey, resolvedEntityType, entityId);
      if (existing) {
        throw AppError.conflict('Ya hay una solicitud de aprobación pendiente para esta operación sobre esta entidad', {
          code: 'DUAL_APPROVAL_ALREADY_PENDING',
          approvalRequestId: existing.approvalRequestId
        });
      }
    }

    // super_admin: cuatro ojos omitido por rol. Se crea la solicitud pero queda aprobada por
    // él mismo (traza completa: requested_by === second_approver_id) y NO se bloquea — la acción
    // real la ejecuta el flujo normal (controller tras next(), o el service inline). No se invoca
    // el handler IoC aquí para no duplicar la ejecución.
    if (this.isSuperAdmin(ctx?.adminRoleName)) {
      return this._gateAutoApprove(opKey, { resolvedEntityType, entityId, payload, ctx });
    }

    const ttlHours = op.ttlHours ?? DEFAULT_TTL_HOURS;
    const expiresAt = addBusinessHours(new Date(), ttlHours);

    const request = await this.approvalRequestRepository.create({
      operationKey: opKey,
      entityType: resolvedEntityType,
      entityId: entityId ?? null,
      payload: (payload ?? {}) as Prisma.InputJsonValue,
      requestedBy: ctx.adminUserId,
      requestedAt: new Date(),
      status: APPROVAL_REQUEST_STATUS.PENDING,
      expiresAt
      // origin_session_id = sesión del MAKER (la completa la extensión de Prisma). El approver resuelve
      // en otra sesión — esa queda en audit_logs, no acá.
    });

    this.notifier.notifyApprovers(op, request, ctx);

    await audit.record('DUAL_APPROVAL_REQUESTED', {
      actorId: ctx.adminUserId,
      details: {
        approvalRequestId: request.approvalRequestId,
        operationKey: opKey,
        entityType: resolvedEntityType,
        entityId: entityId ?? null,
        expiresAt
      },
      entityId: request.approvalRequestId,
      entityType: 'ApprovalRequest',
      entityTable: 'approval_requests'
    });

    return { pending: true, request: ApprovalRequestComponent.build(request) };
  }

  // ── Auto-aprobación por super_admin (cuatro ojos omitido por rol) ──────────────

  /**
   * @param {string} roleName
   * @returns {boolean} true si el rol es superadministrador (legacy o RBAC).
   */
  // eslint-disable-next-line class-methods-use-this
  isSuperAdmin(roleName: string | null | undefined) {
    return !!roleName && SUPERADMIN_ROLE_NAMES.includes(roleName);
  }

  /**
   * Crea la approval_request ya resuelta (approved) por el propio maker super_admin y deja la
   * traza de auditoría (REQUESTED + AUTO_APPROVED). Devuelve { pending:false } para que el flujo
   * normal ejecute la acción real una sola vez. No invoca el handler IoC.
   */
  // eslint-disable-next-line class-methods-use-this
  async _gateAutoApprove(
    opKey: string,
    {
      resolvedEntityType,
      entityId,
      payload,
      ctx
    }: Omit<DualApprovalService.GateArgs, 'entityType'> & { resolvedEntityType: string | null }
  ) {
    const now = new Date();
    const request = await this.approvalRequestRepository.create({
      operationKey: opKey,
      entityType: resolvedEntityType,
      entityId: entityId ?? null,
      payload: (payload ?? {}) as Prisma.InputJsonValue,
      requestedBy: ctx.adminUserId,
      requestedAt: now,
      status: APPROVAL_REQUEST_STATUS.APPROVED,
      secondApproverId: ctx.adminUserId,
      resolvedAt: now,
      resolutionNotes: AUTO_APPROVE_NOTE,
      expiresAt: null
      // Auto-aprobación de super_admin: maker y approver son el mismo, así que la sesión de origen
      // (extensión de Prisma) cubre ambos.
    });

    const auditDetails = {
      approvalRequestId: request.approvalRequestId,
      operationKey: opKey,
      entityType: resolvedEntityType,
      entityId: entityId ?? null
    };
    const auditMeta = {
      entityId: request.approvalRequestId,
      entityType: 'ApprovalRequest',
      entityTable: 'approval_requests'
    };
    await audit.record('DUAL_APPROVAL_REQUESTED', { actorId: ctx.adminUserId, details: auditDetails, ...auditMeta });
    await audit.record('DUAL_APPROVAL_AUTO_APPROVED', {
      actorId: ctx.adminUserId,
      details: auditDetails,
      ...auditMeta
    });

    return { pending: false, autoApproved: true, request: ApprovalRequestComponent.build(request) };
  }

  // ── Resolución (aprobar / rechazar) ───────────────────────────────────────────

  /**
   * @param {string} requestId
   * @param {Object} body — { decision: 'approve'|'reject', notes? }
   * @param {Object} approverCtx — { adminUserId, adminRoleName?, adminFirstName?, ... }
   */
  async resolve(requestId: string, body: DualApprovalService.ResolveBody, approverCtx: AdminAuditContext) {
    const request = await this.approvalRequestRepository.findByIdWithUsers(requestId);
    if (!request) {
      throw AppError.notFound('Solicitud de aprobación no encontrada', { code: 'APPROVAL_REQUEST_NOT_FOUND' });
    }

    if (request.status !== APPROVAL_REQUEST_STATUS.PENDING) {
      throw AppError.conflict(`La solicitud ya está en estado "${request.status}" y no puede re-resolverse`, {
        code: 'APPROVAL_REQUEST_NOT_PENDING'
      });
    }

    const op = _getOp(request.operationKey);
    _assertApproverRole(op, approverCtx.adminRoleName);
    _assertSegregation(request, approverCtx.adminUserId);

    const { decision } = body;
    if (decision === DECISION.APPROVE) {
      return this._approve(request, op, body, approverCtx);
    }
    if (decision === DECISION.REJECT) {
      return this._reject(request, op, body, approverCtx);
    }
    throw AppError.badRequest('Decisión no reconocida', { code: 'INVALID_RESOLUTION_DECISION' });
  }

  async _approve(request: ApprovalRequest, op: DualApprovalConstants.Op, body: DualApprovalService.ResolveBody, approverCtx: AdminAuditContext) {
    const entry = HANDLERS.get(request.operationKey);
    if (!entry || typeof entry.onApprove !== 'function') {
      throw AppError.badRequest(`No hay handler registrado para la operación "${request.operationKey}"`, {
        code: 'DUAL_APPROVAL_NO_HANDLER'
      });
    }

    // El handler es idempotente (RF — §11): si falla la persistencia posterior, la
    // solicitud queda pendiente y puede reintentarse sin doble ejecución.
    const result = await entry.onApprove(request.payload, approverCtx);

    const resolved = await this._resolve(request.approvalRequestId, {
      status: APPROVAL_REQUEST_STATUS.APPROVED,
      secondApproverId: approverCtx.adminUserId,
      resolvedAt: new Date(),
      resolutionNotes: body.notes ?? null,
      result: _sanitizeResult(result)
    });

    this.notifier.notifyMaker(resolved, op, DECISION.APPROVE);

    await audit.record('DUAL_APPROVAL_APPROVED', {
      actorId: approverCtx.adminUserId,
      details: {
        approvalRequestId: request.approvalRequestId,
        operationKey: request.operationKey,
        entityType: request.entityType,
        entityId: request.entityId
      },
      entityId: request.approvalRequestId,
      entityType: 'ApprovalRequest',
      entityTable: 'approval_requests'
    });

    return ApprovalRequestComponent.build(resolved);
  }

  async _reject(request: ApprovalRequest, op: DualApprovalConstants.Op, body: DualApprovalService.ResolveBody, approverCtx: AdminAuditContext) {
    // Reacción opcional del módulo al rechazo (ej: revertir un estado provisional).
    const entry = HANDLERS.get(request.operationKey);
    if (entry && typeof entry.onReject === 'function') {
      await entry.onReject(request.payload, approverCtx);
    }

    const resolved = await this._resolve(request.approvalRequestId, {
      status: APPROVAL_REQUEST_STATUS.REJECTED,
      secondApproverId: approverCtx.adminUserId,
      resolvedAt: new Date(),
      resolutionNotes: body.notes ?? null
    });

    this.notifier.notifyMaker(resolved, op, DECISION.REJECT);

    await audit.record('DUAL_APPROVAL_REJECTED', {
      actorId: approverCtx.adminUserId,
      details: {
        approvalRequestId: request.approvalRequestId,
        operationKey: request.operationKey,
        entityType: request.entityType,
        entityId: request.entityId
      },
      entityId: request.approvalRequestId,
      entityType: 'ApprovalRequest',
      entityTable: 'approval_requests'
    });

    return ApprovalRequestComponent.build(resolved);
  }

  /** Persiste el cierre y devuelve la solicitud recargada (con requester y aprobador). */
  async _resolve(approvalRequestId: string, changes: Parameters<typeof approvalRequestRepository.resolve>[1]) {
    const resolved = await this.approvalRequestRepository.resolve(approvalRequestId, changes);
    if (!resolved) {
      throw AppError.notFound('Solicitud de aprobación no encontrada');
    }
    return resolved;
  }

  // ── Annotate de pendientes en listados ────────────────────────────────────────

  /**
   * Anota cada fila de `rows` con `pendingApproval` (objeto | null) en una sola query batch.
   * `idField`: el campo con el id de la entidad (`userId`, `roleId`…); las filas de Prisma son objetos
   * planos, así que no se puede deducir. Devuelve las mismas `rows` (mutadas) para encadenar.
   */
  // eslint-disable-next-line class-methods-use-this
  async annotatePending<R extends DualApprovalService.AnnotatableRow>(entityType: string, rows: R[], idField: string) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return rows;
    }

    const pkField = idField;
    const asRecord = (r: R) => r as unknown as Record<string, unknown>;
    const ids = rows.map(r => asRecord(r)[pkField]).filter((id): id is string => typeof id === 'string' && id !== '');
    const pendings = await this.approvalRequestRepository.findPendingByEntityIds(entityType, ids);

    const byEntityId = new Map<string | null, ApprovalRequest>();
    for (const p of pendings) {
      byEntityId.set(p.entityId, p);
    }

    for (const row of rows) {
      const pending = byEntityId.get(asRecord(row)[pkField] as string);
      asRecord(row).pendingApproval = pending ? PendingApprovalComponent.build(pending) : null;
    }

    return rows;
  }

  // ── Política para el front ────────────────────────────────────────────────────

  async getPolicy() {
    const entries = await Promise.all(
      Object.entries(DUAL_APPROVAL_OPS).map(async ([opKey, op]) => {
        const base: DualApprovalService.PolicyEntry = {
          operationKey: opKey,
          label: op.label,
          condition: op.condition,
          approverRoles: op.approverRoles,
          entityType: op.entityType,
          ttlHours: op.ttlHours ?? DEFAULT_TTL_HOURS
        };
        if (op.condition === CONDITION.THRESHOLD) {
          base.thresholdField = op.thresholdField;
          base.threshold = await _resolveThreshold(op);
        }
        return base;
      })
    );
    // `enabled` se conserva en el contrato (el front lo lee) pero ya no es configurable: el
    // maker-checker está siempre activo.
    return { enabled: true, operations: entries };
  }

  // ── List / getById para endpoints admin ───────────────────────────────────────

  // eslint-disable-next-line class-methods-use-this
  async list(query: ApprovalListQuery) {
    const page = pageRequest(query);
    const filters = { operationKey: query.operationKey, status: query.status, entityType: query.entityType };
    const { rows, count } = await this.approvalRequestRepository.findAllPaginatedWithUsers(filters, page, query.search ?? null);
    return pageOf(
      rows.map(r => ApprovalRequestComponent.buildList(r)),
      page,
      count,
      { search: query.search, ...filters }
    );
  }

  // eslint-disable-next-line class-methods-use-this
  async getById(id: string) {
    const request = await this.approvalRequestRepository.findByIdWithUsers(id);
    if (!request) {
      throw AppError.notFound('Solicitud de aprobación no encontrada', { code: 'APPROVAL_REQUEST_NOT_FOUND' });
    }
    return ApprovalRequestComponent.build(request);
  }

}

// ── Helpers privados ────────────────────────────────────────────────────────────

// opKey llega como string (BD / call-sites JS): se busca en el registro sin asumir que es válido
function _findOp(opKey: string): DualApprovalConstants.Op | undefined {
  return (DUAL_APPROVAL_OPS as Record<string, DualApprovalConstants.Op | undefined>)[opKey];
}

function _getOp(opKey: string): DualApprovalConstants.Op {
  const op = _findOp(opKey);
  if (!op) {
    throw AppError.badRequest(`Operación de doble aprobación desconocida: ${opKey}`, { code: 'UNKNOWN_DUAL_APPROVAL_OP' });
  }
  return op;
}

async function _resolveThreshold(op: DualApprovalConstants.Op): Promise<number> {
  if (!op.thresholdConfigKey) {
    return op.thresholdDefault ?? 0;
  }
  try {
    // require perezoso: evita un ciclo de carga con los módulos que dependen de dual-approval
    const systemGlobalConfigRepository = interopDefault(require('../../settings') as typeof import('../../settings')).systemGlobalConfigRepository as SystemGlobalConfigRepositoryPort;
    const cfg = await systemGlobalConfigRepository.findActive();
    // La clave puede venir con el nombre de la columna (snake_case) o del campo de Prisma
    const key = op.thresholdConfigKey.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
    const raw = cfg ? (cfg as unknown as Record<string, unknown>)[key] : null;
    if (raw === null || raw === undefined) {
      return op.thresholdDefault ?? 0;
    }
    return Number(raw);
  } catch (err) {
    logger.warn('[DualApproval] No se pudo leer umbral de SystemGlobalConfig — usando default', {
      error: errorMessage(err),
      configKey: op.thresholdConfigKey
    });
    return op.thresholdDefault ?? 0;
  }
}

function _assertApproverRole(op: DualApprovalConstants.Op, roleName: string | null | undefined) {
  // Si no se conoce el rol (ctx incompleto) no se bloquea por rol; el RBAC de ruta ya filtró.
  if (!roleName) {
    return;
  }
  const allowed = new Set([...(op.approverRoles ?? []), ...WILDCARD_ROLES]);
  if (!allowed.has(roleName)) {
    throw AppError.forbidden('Tu rol no está autorizado a resolver esta operación', { code: 'DUAL_APPROVAL_ROLE_NOT_ALLOWED' });
  }
}

function _assertSegregation(request: ApprovalRequest, approverUserId: string) {
  if (request.requestedBy === approverUserId) {
    throw AppError.forbidden('El segundo aprobador no puede ser el mismo que originó la operación (segregación de funciones)', {
      code: 'DUAL_APPROVAL_SAME_AS_MAKER'
    });
  }
}

// Guarda en `result` solo datos serializables y acotados (evita persistir objetos con referencias o ciclos).
function _sanitizeResult(result: unknown) {
  if (result === null || result === undefined) {
    return null;
  }
  try {
    return JSON.parse(JSON.stringify(result));
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace DualApprovalService {
  /** Reanudación (o reacción al rechazo) que registra cada operación. */
  export type Handler<P = unknown> = (payload: P, ctx: AdminAuditContext) => Promise<unknown>;

  /** Avisos del framework (DualApprovalNotifierService o un doble). */
  export type Notifier = Pick<DualApprovalNotifierService, 'notifyApprovers' | 'notifyMaker'>;

  export interface GateArgs {
    entityType?: string | null;
    entityId?: string | null;
    payload?: unknown;
    ctx: AdminAuditContext;
  }

  export interface ResolveBody {
    decision: string;
    notes?: string | null;
  }

  /** Fila que se puede anotar con pendingApproval (instancia de modelo o fila plana). */
  export type AnnotatableRow = object;
  /** @deprecated forma anterior; se mantiene el nombre para los call-sites */
  export interface AnnotatableRowShape {
    [column: string]: unknown;
    pendingApproval?: unknown;
  }

  export interface PolicyEntry {
    operationKey: string;
    label: string;
    condition: DualApprovalConstants.Op['condition'];
    approverRoles: string[];
    entityType: string;
    ttlHours: number;
    thresholdField?: string;
    threshold?: number;
  }

  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    notifier?: Notifier;
    approvalRequestRepository?: typeof approvalRequestRepository;
    userRepository?: typeof userRepository;
    notifications?: typeof notifications;
  }
}

export default Object.assign(new DualApprovalService(), { DualApprovalService });
