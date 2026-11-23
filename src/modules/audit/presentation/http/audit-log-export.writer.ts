// Escritura de la exportación de auditoría en la respuesta HTTP: CSV (con BOM para Excel) o XLSX en stream.
// Las filas ya vienen armadas por el caso de uso ExportAuditLogs.
import type { Response } from 'express';
import ExcelJS from 'exceljs';
import { AUDIT_LOG_EXPORT_COLUMNS, type AuditLogExportRow } from '../../application/dto/audit-log.output';

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const str = value instanceof Date ? value.toISOString() : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function attachment(res: Response, contentType: string, filename: string, truncated: boolean) {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  if (truncated) {
    res.setHeader('X-Export-Truncated', 'true');
  }
}

export function writeAuditLogCsv(res: Response, rows: AuditLogExportRow[], truncated: boolean): void {
  attachment(res, 'text/csv; charset=utf-8', 'audit-logs.csv', truncated);
  res.write('﻿'); // BOM para Excel
  res.write(`${AUDIT_LOG_EXPORT_COLUMNS.join(',')}\n`);
  for (const row of rows) {
    res.write(`${AUDIT_LOG_EXPORT_COLUMNS.map(col => escapeCsv(row[col])).join(',')}\n`);
  }
  res.end();
}

export async function writeAuditLogXlsx(res: Response, rows: AuditLogExportRow[], truncated: boolean): Promise<void> {
  attachment(res, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'audit-logs.xlsx', truncated);
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res });
  const sheet = workbook.addWorksheet('Audit Logs');
  sheet.columns = AUDIT_LOG_EXPORT_COLUMNS.map(col => ({ header: col, key: col, width: 25 }));
  for (const row of rows) {
    sheet.addRow(Object.fromEntries(AUDIT_LOG_EXPORT_COLUMNS.map(col => [col, row[col] ?? '']))).commit();
  }
  await workbook.commit();
}
