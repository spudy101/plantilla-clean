import legalComponentsModule from './legal-components.response';
const { UserConsentComponent } = legalComponentsModule;

const UserConsentAuditItemDTO = (record: Parameters<typeof UserConsentComponent.build>[0]) => UserConsentComponent.build(record);

export default { UserConsentAuditItemDTO };
