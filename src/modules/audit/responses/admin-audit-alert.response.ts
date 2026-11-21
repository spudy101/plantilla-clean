import { z } from '../../../shared/validation/z';
import componentsAuditDtoModule from './audit-components.response';
const { AuditAlertComponent } = componentsAuditDtoModule;

const AuditAlertListDTO = (record: Parameters<typeof AuditAlertComponent.build>[0]) => AuditAlertComponent.build(record);

export default { AuditAlertListDTO };

// ── Esquema de salida (resultado armado en el service, sin función DTO) ──
export const AlertsAcknowledgedSchema = z.object({
  acknowledged: z.number().int().meta({ example: 3, description: 'Alertas que se marcaron como reconocidas.' }),
  requested: z.number().int().meta({ example: 3, description: 'Alertas enviadas en la petición.' })
});
export type AlertsAcknowledged = z.infer<typeof AlertsAcknowledgedSchema>;
