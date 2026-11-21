import type { ConsentType } from '../../../shared/infrastructure/database/generated/prisma/client';
import type { AdminAuditContext } from '../../../shared/application/audit-context';
import AppError from '../../../shared/presentation/http/app-error.util';
import loggerUtilModule from '../../../shared/infrastructure/observability/logger.util';
const { logger } = loggerUtilModule;
import consentTypeRepository from '../repositories/consent-type.repository';
import notificationModule from '../../notification';
const { notifier } = notificationModule;
import constantsModule from '../../../shared/infrastructure/config';
const { notifications } = constantsModule;
import consentTypeDtoModule from '../responses/consent-type.response';
const { ConsentTypeListDTO, ConsentTypeDTO } = consentTypeDtoModule;
import auditModule from '../../audit';
import { pageOf, pageRequest } from '../../../shared/application/pagination';
import type { ConsentTypeListQuery } from '../requests/legal.request';
const { audit } = auditModule;

class ConsentTypeService {
  consentTypeRepository: typeof consentTypeRepository;
  notifier: typeof notifier;

  /**
   * Dependencias inyectables (SOLID: D). Por defecto se usan las implementaciones
   * reales; en tests u otros contextos se pueden reemplazar:
   *   new ConsentTypeService({ consentTypeRepository: fake })
   * @param {object} [deps]
   */
  constructor(deps: ConsentTypeService.Deps = {}) {
    this.consentTypeRepository = deps.consentTypeRepository ?? consentTypeRepository;
    this.notifier = deps.notifier ?? notifier;
  }

  async list(query: ConsentTypeListQuery, adminUserId: string) {
    const page = pageRequest(query);
    const { rows, count } = await this.consentTypeRepository.findAllPaginated({}, page, query.search ?? null);

    await audit.record('CONSENT_TYPE_LIST_VIEWED', {
      actorId: adminUserId,
      details: { totalItems: count, page: page.page },
      entityType: 'ConsentType',
      entityTable: 'consent_types'
    });

    return pageOf(rows.map(r => ConsentTypeListDTO(r)), page, count, { search: query.search });
  }

  async getById(consentTypeId: string, adminUserId: string) {
    const record = await this.consentTypeRepository.findById(consentTypeId);
    if (!record) {
      throw AppError.notFound('Tipo de consentimiento no encontrado');
    }

    await audit.record('CONSENT_TYPE_DETAIL_VIEWED', {
      actorId: adminUserId,
      details: { code: record.code },
      entityType: 'ConsentType',
      entityTable: 'consent_types',
      entityId: consentTypeId
    });

    return ConsentTypeDTO(record);
  }

  async create(body: ConsentTypeService.CreateInput, auditCtx: AdminAuditContext) {
    // Se guarda en mayúsculas: la unicidad se verifica con el código ya normalizado (antes se buscaba
    // el código tal cual llegaba y "abc" pasaba el chequeo aunque existiera "ABC" → 500 por la UNIQUE).
    const code = body.code.toUpperCase();
    const existing = await this.consentTypeRepository.findAnyByCode(code);
    if (existing) {
      throw AppError.conflict(`Ya existe un tipo de consentimiento con el código "${code}"`);
    }

    const record = await this.consentTypeRepository.create({
      code,
      name: body.name,
      description: body.description || null,
      isMandatory: body.isMandatory !== false,
      isRevocable: body.isRevocable === true,
      isActive: true
    });

    await audit.record('CONSENT_TYPE_CREATED', {
      actorId: auditCtx.adminUserId,
      details: { code: record.code, name: record.name },
      entityType: 'ConsentType',
      entityTable: 'consent_types',
      entityId: record.consentTypeId
    });

    logger.info('ConsentTypeService.create', { code: record.code, adminUserId: auditCtx.adminUserId });
    this._notifyAdmin('creado', record, auditCtx);
    return ConsentTypeDTO(record);
  }

  async update(consentTypeId: string, body: Partial<Pick<ConsentTypeService.CreateInput, 'name' | 'description' | 'isActive'>>, auditCtx: AdminAuditContext) {
    const record = await this.consentTypeRepository.findById(consentTypeId);
    if (!record) {
      throw AppError.notFound('Tipo de consentimiento no encontrado');
    }

    const updated = await this.consentTypeRepository.update(consentTypeId, {
      name: body.name ?? record.name,
      description: body.description !== undefined ? body.description : record.description,
      isActive: body.isActive !== undefined ? body.isActive : record.isActive
    });
    if (!updated) {
      throw AppError.notFound('Tipo de consentimiento no encontrado');
    }

    await audit.record('CONSENT_TYPE_UPDATED', {
      actorId: auditCtx.adminUserId,
      details: { consentTypeId, changes: body },
      entityType: 'ConsentType',
      entityTable: 'consent_types',
      entityId: consentTypeId
    });

    this._notifyAdmin('actualizado', updated, auditCtx);
    return ConsentTypeDTO(updated);
  }

  /** @private — push de confirmación al administrador que realizó la acción */
  _notifyAdmin(accion: string, record: Pick<ConsentType, 'consentTypeId' | 'code' | 'name'>, auditCtx: AdminAuditContext) {
    setImmediate(() => {
      this.notifier.notify({
        type: 'CONSENT_TYPE_ADMIN_ACTION',
        userId: auditCtx.adminUserId,
        relatedEntity: { type: 'ConsentType', id: record.consentTypeId },
        metadata: {
          accion,
          code: record.code,
          logoUrl: notifications.ses.logoUrl
        }
      }).catch(err =>
        logger.warn('Error enviando notificación admin consent-type', {
          error: err.message,
          accion
        })
      );
    });
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace ConsentTypeService {
  export interface CreateInput {
    code: string;
    name: string;
    description?: string | null;
    isMandatory?: boolean;
    isRevocable?: boolean;
    isActive?: boolean;
  }

  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    consentTypeRepository?: typeof consentTypeRepository;
    notifier?: typeof notifier;
  }
}

export default Object.assign(new ConsentTypeService(), { ConsentTypeService });
