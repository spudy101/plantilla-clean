// tests/unit/loadability/modules.loadability.test.ts
//
// Load-test de cargabilidad de src/modules/: todo archivo se puede require() sin lanzar.
// Ver la mecánica en tests/helpers/loadability.ts.

import loadabilityModule from 'tests/helpers/loadability';
const { describeLoadability } = loadabilityModule;

describeLoadability('src/modules');
