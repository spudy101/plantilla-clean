// modules/admin/privacy-policy/services/privacy-policy-admin.service.ts
//
// Lógica de negocio del mantenedor de Políticas de Privacidad.
//
// Flujo de createVersion:
//   1. Validar que la versión no exista
//   2. Construir la S3 key con el número de versión (ej: legal/privacy-policy-v1.1.pdf)
//   3. Subir el PDF al bucket PÚBLICO via S3Util.uploadPublicDocument()
//   4. Invalidar caché de CloudFront para que el nuevo PDF sea inmediatamente visible
//   5. Crear el registro en BD con la URL pública y marcarlo is_active = true
//      (el repositorio desactiva automáticamente la versión anterior)

import crypto from 'node:crypto';
import privacyPolicyAdminRepository from '../repositories/privacy-policy-admin.repository';
import S3Util from '../../../shared/infra/s3.util';
import redisClient from '../../../shared/infra/redis.util';
import AppError from '../../../shared/http/app-error.util';
import loggerUtilModule from '../../../shared/observability/logger.util';
const { logger } = loggerUtilModule;
import notificationModule from '../../notification';
const { notifier } = notificationModule;
import privacyPolicyAdminDtoModule from '../responses/privacy-policy-admin.response';
import auditModule from '../../audit';
import { pageMetadata, pageRequest } from '../../../shared/http/pagination';
import type { PrivacyPolicyListQuery } from '../requests/legal.request';
const { audit } = auditModule;
const {
  ListPrivacyPoliciesResponseDTO,
  PrivacyPolicyDetailResponseDTO,
  PrivacyPolicyCreatedResponseDTO
} = privacyPolicyAdminDtoModule;

class PrivacyPolicyAdminService {
  privacyPolicyAdminRepository: typeof privacyPolicyAdminRepository;
  notifier: typeof notifier;

  /**
   * Dependencias inyectables (SOLID: D). Por defecto se usan las implementaciones
   * reales; en tests u otros contextos se pueden reemplazar:
   *   new PrivacyPolicyAdminService({ privacyPolicyAdminRepository: fake })
   * @param {object} [deps]
   */
  constructor(deps: PrivacyPolicyAdminService.Deps = {}) {
    this.privacyPolicyAdminRepository = deps.privacyPolicyAdminRepository ?? privacyPolicyAdminRepository;
    this.notifier = deps.notifier ?? notifier;
  }

  // ============================================================
  // LIST — paginado con filtros
  // ============================================================

  /**
   * Lista todas las versiones de la política con paginación.
   *
   * Query params soportados:
   *   page, limit, sortBy, order  — paginación estándar
   *   search                      — busca en version y summary
   *   isActive                    — filtra por estado (true/false)
   *
   * @param query   - la query ya validada (PrivacyPolicyListQuery)
   * @param userId  - ID del admin que consulta (para auditoría)
   */
  async listVersions(query: PrivacyPolicyListQuery, userId: string) {
    const page = pageRequest(query);
    const filters = { isActive: query.isActive ?? undefined };

    const { rows, count } = await this.privacyPolicyAdminRepository.findAllPaginated(filters, page, query.search ?? null);

    await audit.record('PRIVACY_POLICY_LIST_VIEWED', {
      actorId: userId,
      details: {
        totalItems: count,
        page: page.page
      },
      entityType: 'PrivacyPolicy',
      entityTable: 'privacy_policies'
    });

    return ListPrivacyPoliciesResponseDTO(rows, pageMetadata(page, count, { search: query.search, ...filters }));
  }

  // ============================================================
  // DETAIL — una versión por ID con URL del PDF
  // ============================================================

  /**
   * Retorna el detalle de una versión incluyendo la URL pública del PDF.
   * La URL ya es pública via CloudFront — no se genera presigned URL.
   *
   * @param {string} privacyPolicyId - UUID de la política
   * @param {string} userId          - ID del admin (para auditoría)
   */
  async getVersionDetail(privacyPolicyId: string, userId: string) {
    const policy = await this.privacyPolicyAdminRepository.findById(privacyPolicyId);
    if (!policy) {
      throw AppError.notFound('Versión de política de privacidad no encontrada');
    }

    await audit.record('PRIVACY_POLICY_DETAIL_VIEWED', {
      actorId: userId,
      details: { version: policy.version },
      entityId: privacyPolicyId,
      entityType: 'PrivacyPolicy',
      entityTable: 'privacy_policies'
    });

    return PrivacyPolicyDetailResponseDTO(policy);
  }

  // ============================================================
  // CREATE — nueva versión con upload a S3 público
  // ============================================================

  /**
   * Publica una nueva versión de la política de privacidad.
   *
   * Pasos:
   *   1. Validar que la versión no exista en BD
   *   2. Subir el PDF al bucket público con key predecible
   *   3. Invalidar caché CloudFront
   *   4. Crear registro en BD (desactiva la versión anterior automáticamente)
   *
   * @param {Object} data
   * @param {string}   data.version        - Ej: "1.1", "2.0"
   * @param {Buffer}   data.fileBuffer     - Buffer del PDF subido via multer
   * @param {string}   data.originalName   - Nombre original del archivo (para validación)
   * @param {string}   [data.summary]      - Resumen de cambios (opcional)
   * @param {Date}     [data.effectiveDate] - Fecha de entrada en vigor (default: ahora)
   * @param {string}   userId              - ID del admin que crea la versión
   */
  async createVersion(
    data: { version: string; fileBuffer: Buffer; originalName?: string; summary?: string | null; effectiveDate?: Date },
    userId: string
  ) {
    const { version, fileBuffer, summary, effectiveDate } = data;

    // 1. Verificar que la versión no exista
    const existing = await this.privacyPolicyAdminRepository.findByVersion(version);
    if (existing) {
      throw AppError.conflict(`La versión ${version} ya existe`);
    }

    // 2. Subir PDF al bucket público
    //    Key predecible: legal/privacy-policy-v{version}.pdf
    //    Ejemplo: legal/privacy-policy-v1.1.pdf
    const sanitizedVersion = version.replaceAll('.', '-'); // 1.1 → 1-1 (safe para URL)
    const s3Key = `legal/privacy-policy-v${sanitizedVersion}.pdf`;

    const documentUrl = await S3Util.uploadPublicDocument(fileBuffer, s3Key, 'application/pdf');

    // 3. Invalidar caché CloudFront (no bloquea si falla)
    await S3Util.invalidateCloudFront(`/${s3Key}`);

    // [RF-LP-01] | CA-01 | Invalida cache Redis al publicar nueva versión legal
    await redisClient.del('cache:privacy-policy:active');

    // 4. Crear registro en BD
    //    El repositorio desactiva la versión anterior automáticamente
    const documentHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    const policy = await this.privacyPolicyAdminRepository.createVersion({
      version,
      documentUrl,
      documentHash,
      summary: summary || null,
      effectiveDate: effectiveDate || new Date()
    });

    await audit.record('PRIVACY_POLICY_VERSION_CREATED', {
      actorId: userId,
      details: {
        version,
        documentUrl,
        s3Key
      },
      entityId: policy.privacyPolicyId,
      entityType: 'PrivacyPolicy',
      entityTable: 'privacy_policies'
    });

    // RF-ADM-04: notificar a todos los usuarios activos en background
    setImmediate(() => {
      this.notifier.notify({
        type: 'PRIVACY_POLICY_UPDATE',
        userId: null, // null = notificación global
        metadata: {
          nuevaVersion: version,
          fechaVigencia: policy.effectiveDate.toISOString().split('T')[0] ?? version,
          resumenCambios: summary || 'Hemos realizado mejoras en nuestra política para proteger mejor tus datos.',
          documentUrl
        }
      }).catch(err =>
        logger.warn('Error enviando notificación de actualización de política', {
          error: err.message,
          version
        })
      );
    });

    return PrivacyPolicyCreatedResponseDTO(policy);
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace PrivacyPolicyAdminService {
  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    privacyPolicyAdminRepository?: typeof privacyPolicyAdminRepository;
    notifier?: typeof notifier;
  }
}

export default Object.assign(new PrivacyPolicyAdminService(), { PrivacyPolicyAdminService });
