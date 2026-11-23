// Adaptador del puerto AuditArchive con S3 (STANDARD_IA; el lifecycle a Glacier lo gestiona Terraform).
import S3Util from '../../../../shared/infrastructure/storage/s3.util';
import type { AuditArchive } from '../../application/ports/audit-archive.port';

export const s3AuditArchive: AuditArchive = {
  upload: (key, jsonLines) => S3Util.uploadArchive(key, jsonLines)
};
