// La taxonomía del catálogo (valores válidos de acción, categoría, riesgo, módulo, resultado y origen) para
// que la presentación valide filtros y documente enums sin conocer el dominio.
import catalogModule from '../../domain/catalog';

const { AUDIT_ACTIONS, AUDIT_CATEGORIES, AUDIT_RISKS, AUDIT_MODULES, AUDIT_OUTCOMES, AUDIT_SOURCES } = catalogModule;

const values = (o: Record<string, string>) => Object.values(o) as [string, ...string[]];

export const AUDIT_TAXONOMY = Object.freeze({
  actions: Object.keys(AUDIT_ACTIONS),
  categories: values(AUDIT_CATEGORIES),
  risks: values(AUDIT_RISKS),
  modules: values(AUDIT_MODULES),
  outcomes: values(AUDIT_OUTCOMES),
  sources: values(AUDIT_SOURCES)
});
