import type { Response } from 'express';
import ExcelJS from 'exceljs';
import AppError from '../../../shared/http/app-error.util';
import loggerUtilModule from '../../../shared/observability/logger.util';
const { logger } = loggerUtilModule;
import auditLogRepository from '../repositories/audit-log.repository';
import adminAuditLogDtoModule from '../responses/admin-audit-log.response';
const { AuditLogListDTO, AuditLogDTO } = adminAuditLogDtoModule;
import audit from '../audit.service';
import { appliedFilters, pageMetadata, pageRequest } from '../../../shared/http/pagination';
import type { AuditLogListQuery } from '../requests/audit.request';

/** Los filtros con valor, sin null (el repositorio los recibe como opcionales). */
const definedOnly = <T extends Record<string, unknown>>(filters: T) =>
  Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== null && v !== undefined)) as { [K in keyof T]?: NonNullable<T[K]> };

const EXPORT_LIMIT = 50000;

const CSV_COLUMNS = [
  'audit_log_id',
  'action',
  'description',
  'category',
  'risk',
  'outcome',
  'user_id',
  'session_id',
  'entity_id',
  'entity_type',
  'correlation_id',
  'ip',
  'source',
  'created_at'
];

class AdminAuditLogService {
  auditLogRepository: typeof auditLogRepository;

  /**
   * Dependencias inyectables (SOLID: D). Por defecto se usan las implementaciones
   * reales; en tests u otros contextos se pueden reemplazar:
   *   new AdminAuditLogService({ auditLogRepository: fake })
   * @param {object} [deps]
   */
  constructor(deps: AdminAuditLogService.Deps = {}) {
    this.auditLogRepository = deps.auditLogRepository ?? auditLogRepository;
  }

  async list(query: AuditLogListQuery, adminUserId: string) {
    const { page: pageNumber, limit, sortBy, order, ...filters } = query;
    const page = pageRequest({ page: pageNumber, limit, sortBy, order });
    // Los filtros de negocio se traducen a WHERE dentro del repositorio.
    const { rows, count } = await this.auditLogRepository.searchPaginated(definedOnly(filters), page);
    const activeFilters = appliedFilters(filters);

    await audit.record('AUDIT_LOG_LISTED', {
      actorId: adminUserId,
      details: { totalItems: count, filters: Object.keys(activeFilters) },
      entityType: 'AuditLog',
      entityTable: 'audit_logs'
    });

    return {
      data: rows.map(r => AuditLogListDTO(r)),
      metadata: pageMetadata(page, count, activeFilters)
    };
  }

  async getById(auditLogId: string, adminUserId: string) {
    const record = await this.auditLogRepository.findByIdFull(auditLogId);
    if (!record) {
      throw AppError.notFound('Log de auditoría no encontrado');
    }

    await audit.record('AUDIT_LOG_VIEWED', {
      actorId: adminUserId,
      details: { auditLogId },
      entityId: auditLogId,
      entityType: 'AuditLog',
      entityTable: 'audit_logs'
    });

    return AuditLogDTO(record);
  }

  async exportToResponse(res: Response, query: Record<string, unknown>, adminUserId: string, format = 'csv') {
    const rows = await this.auditLogRepository.searchForExport(query, EXPORT_LIMIT);

    const truncated = rows.length === EXPORT_LIMIT;

    await audit.record('AUDIT_LOG_EXPORTED', {
      actorId: adminUserId,
      details: { format, count: rows.length, truncated },
      entityType: 'AuditLog',
      entityTable: 'audit_logs'
    });

    logger.info('AdminAuditLogService.export', { adminUserId, format, count: rows.length, truncated });

    if (format === 'xlsx') {
      return _streamXlsx(res, rows, truncated);
    }
    return _streamCsv(res, rows, truncated);
  }
}

function _escapeCsv(value: unknown) {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Fila exportada: se leen las columnas de CSV_COLUMNS por nombre. */
type ExportRow = object;

function _streamCsv(res: Response, rows: ExportRow[], truncated: boolean) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="audit-logs.csv"');
  if (truncated) {
    res.setHeader('X-Export-Truncated', 'true');
  }

  res.write('﻿'); // BOM para Excel
  res.write(`${CSV_COLUMNS.join(',')}\n`);

  for (const row of rows) {
    const line = CSV_COLUMNS.map(col => _escapeCsv((row as Record<string, unknown>)[col])).join(',');
    res.write(`${line}\n`);
  }

  res.end();
}

async function _streamXlsx(res: Response, rows: ExportRow[], truncated: boolean) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="audit-logs.xlsx"');
  if (truncated) {
    res.setHeader('X-Export-Truncated', 'true');
  }

  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res });
  const sheet = workbook.addWorksheet('Audit Logs');

  sheet.columns = CSV_COLUMNS.map(col => ({ header: col, key: col, width: 25 }));

  for (const row of rows) {
    const data: Record<string, unknown> = {};
    for (const col of CSV_COLUMNS) {
      data[col] = (row as Record<string, unknown>)[col] ?? '';
    }
    sheet.addRow(data).commit();
  }

  await workbook.commit();
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace AdminAuditLogService {
  /** Dependencias inyectables (SOLID: D); sin ellas se usan las instancias reales. */
  export interface Deps {
    auditLogRepository?: typeof auditLogRepository;
  }
}

export default Object.assign(new AdminAuditLogService(), { AdminAuditLogService });
