// Entrada del monitoreo de proveedores (solo lectura): filtros del historial de caídas.
import { z, withHint } from '../../../../../shared/presentation/validation/z';
import { optionalBool, optionalIsoDate, pageQuery } from '../../../../../shared/presentation/validation/fields';

export const FallbackQuery = z.object({
  ...pageQuery(['startedAt', 'endedAt'], { sortBy: 'startedAt' }),
  provider: withHint(z.string().trim().max(50).optional(), { hint: 'Usá el nombre del proveedor (hasta 50 caracteres)' }),
  activeOnly: optionalBool('activeOnly'),
  from: optionalIsoDate('La fecha desde'),
  to: optionalIsoDate('La fecha hasta')
});
export type FallbackQuery = z.output<typeof FallbackQuery>;
