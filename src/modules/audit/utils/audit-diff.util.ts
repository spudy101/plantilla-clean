/**
 * Calcula el diff entre el estado actual de una entidad y los datos entrantes.
 *
 * @param {Object} entity   - Instancia Sequelize o POJO con los valores actuales (snake_case)
 * @param {Object} data     - Datos entrantes del request (camelCase)
 * @param {Object} fieldMap - Mapeo { camelCaseKey: 'snake_case_column' }
 * @returns {{ before: Object, after: Object }} Solo los campos que efectivamente cambian.
 *
 * @example
 * const { before, after } = buildAuditDiff(role, data, {
 *   name: 'name',
 *   description: 'description',
 *   isActive: 'isActive'   // campo de la fila (camelCase en las filas de Prisma)
 * });
 */
type Bag = Record<string, unknown>;

function buildAuditDiff(
  entity: object,
  data: object,
  fieldMap: Record<string, string>
): { before: Bag; after: Bag } {
  const current = entity as Bag;
  const incoming = data as Bag;
  const before: Bag = {};
  const after: Bag = {};

  for (const [camelKey, snakeKey] of Object.entries(fieldMap)) {
    if (incoming[camelKey] === undefined) {
      continue;
    }
    const currentValue = current[snakeKey];
    const newValue = incoming[camelKey];
    if (currentValue !== newValue) {
      before[camelKey] = currentValue ?? null;
      after[camelKey] = newValue ?? null;
    }
  }

  return { before, after };
}

export default { buildAuditDiff };
