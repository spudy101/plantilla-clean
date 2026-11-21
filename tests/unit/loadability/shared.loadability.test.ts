// tests/unit/loadability/shared.loadability.test.ts
//
// Load-test de cargabilidad del núcleo transversal `shared/` (utils, services,
// middlewares, validators, dtos, repositories, constants, etc.). Ver la mecánica
// y el porqué en tests/helpers/loadability.js.

import loadabilityModule from 'tests/helpers/loadability';
const { describeLoadability } = loadabilityModule;

describeLoadability('src/shared');
