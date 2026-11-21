import componentsAuditDtoModule from './audit-components.response';
const { AuditLogComponent } = componentsAuditDtoModule;

const AuditLogListDTO = (record: Parameters<typeof AuditLogComponent.buildList>[0]) => AuditLogComponent.buildList(record);
const AuditLogDTO = (record: Parameters<typeof AuditLogComponent.buildDetail>[0]) => AuditLogComponent.buildDetail(record);

export default { AuditLogListDTO, AuditLogDTO };
