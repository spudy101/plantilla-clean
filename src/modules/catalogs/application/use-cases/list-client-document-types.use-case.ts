// Caso de uso: los tipos de documento del selector del formulario del cliente (todos los visibles, por
// nombre, sin paginar). La respuesta lleva igual la metadata de un listado, para que el cliente la lea
// como cualquier otro.
import type { AuditTrail } from '../../../../shared/application/ports/audit-trail.port';
import { pageMetadata } from '../../../../shared/application/pagination';
import type { ClientDocumentTypeReader } from '../ports/catalog-reader.port';
import { toDocumentTypeOutput, type ListOutput } from '../dto/catalog.output';

export class ListClientDocumentTypes {
  constructor(
    private readonly documentTypes: ClientDocumentTypeReader,
    private readonly audit: AuditTrail
  ) {}

  async execute({ actorId = null }: { actorId?: string | null } = {}): Promise<
    ListOutput<ReturnType<typeof toDocumentTypeOutput>>
  > {
    const items = await this.documentTypes.listVisibleToClient();

    await this.audit.record('MAINTAINER_DOCUMENT_TYPES_VIEWED', {
      actorId,
      details: { totalItems: items.length },
      entityType: 'Catalog',
      entityTable: null
    });

    return {
      data: items.map(toDocumentTypeOutput),
      metadata: pageMetadata({ page: 1, limit: items.length || 1, sortBy: 'name', order: 'ASC' }, items.length)
    };
  }
}
