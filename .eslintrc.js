// =============================================================================
// ESLINT - Cultural Hackers Consulting
// Basado en: Estándares de Desarrollo Backend v1.0 - Abril 2026
// =============================================================================
// NOTA: Los nombres de archivo (kebab-case + sufijo), la estructura de
// directorios y el orden de imports NO pueden validarse con ESLint nativo.
// Para nombres de archivo instalar: eslint-plugin-filenames-simple
//   npm install --save-dev eslint-plugin-filenames-simple
// =============================================================================

// ESLint se ejecuta sin haber cargado el .env, por lo que importar
// shared/constants aquí dispararía el fail-fast de validación de variables.
// La única excepción permitida: leer NODE_ENV directo para configurar no-console.
const isProduction = process.env.NODE_ENV === 'production';

// Números permitidos sin constante (HTTP status, potencias, ms/segundos comunes). Los comparten la
// regla base y la de TypeScript (@typescript-eslint/no-magic-numbers no hereda las opciones de la base).
const MAGIC_NUMBER_IGNORE = [
  -1,
  0,
  1,
  2,
  10,
  100,
  60, // minutos/segundos
  3600, // segundos en una hora
  24, // horas en un día
  1000, // ms en un segundo
  10000, // ms (timeout común)
  1024, // bytes → KB
  200,
  201,
  204,
  400,
  401,
  403,
  404,
  409,
  422,
  429,
  500,
  503
];

module.exports = {
  // Archivos/carpetas que ESLint ignora completamente.
  // prisma/migrations es SQL; los scripts son de un solo uso — no hace falta
  // que cumplan los estándares del proyecto. El seed (prisma/seed.ts, prisma/seeds/) sí se lintea.
  ignorePatterns: ['dist/**', 'coverage/**', '**/generated/**', '**/migrations/**', '**/scripts/**', '.eslintrc.js'],

  // Declara los globals disponibles según el entorno para que ESLint
  // no los marque como "variable no definida".
  // node    → process, require, __dirname, module, etc.
  // es2021  → Promise, Map, Set, globalThis, etc.
  // jest    → describe, it, expect, beforeEach, etc.
  env: {
    node: true,
    es2021: true,
    jest: true
  },

  // eslint:recommended activa un conjunto base de reglas de calidad
  // (no-undef, no-unused-vars básico, etc.) que luego sobreescribimos
  // o ampliamos en la sección rules.
  extends: ['eslint:recommended', 'prettier'],

  parserOptions: {
    ecmaVersion: 'latest', // Permite sintaxis moderna (optional chaining, nullish, etc.)
    sourceType: 'module' // Permite import/export aunque el proyecto use CommonJS
  },

  // Plugin externo para validar nombres de archivo.
  // Sin esto ESLint solo valida el contenido, no el nombre del archivo.
  plugins: ['filenames-simple'],

  rules: {
    // =========================================================================
    // §1.1 — VARIABLES Y CONSTANTES
    // =========================================================================

    // Fuerza camelCase en nombres de variables, parámetros y funciones.
    // properties: 'never' → las propiedades de objetos quedan libres,
    // lo que permite snake_case en filas de SQL crudo y claves de JSONB guardado.
    // ignoreDestructuring: true → const { agreement_type } = req.body no se renombra;
    //   desestructurar campos snake_case de BD es el patrón del proyecto.
    camelcase: [
      'error',
      {
        properties: 'never',
        ignoreDestructuring: true,
        ignoreImports: false,
        ignoreGlobals: false
      }
    ],

    // Complementa camelcase imponiendo UPPER_SNAKE_CASE para constantes de módulo.
    // El regex permite: camelCase, PascalCase, UPPER_SNAKE_CASE y prefijo _.
    // properties: false → no aplica a propiedades de objetos (campos DB snake_case).
    // ignoreDestructuring: true → const { user_id } = row no da error al desestructurar.
    // onlyDeclarations: true → solo revisa nombres en su declaración, no cada uso;
    //   evita falsos positivos al usar variables snake_case de BD desestructuradas.
    'id-match': [
      'error',
      '^(_?[a-z][a-zA-Z0-9]*|[A-Z][A-Z0-9_]*|[A-Z][a-zA-Z0-9]*|_[a-z][a-zA-Z0-9]*|\\$[a-zA-Z0-9]*)$',
      {
        properties: false,
        onlyDeclarations: true,
        ignoreDestructuring: true
      }
    ],

    // Prohíbe var por completo. Solo const y let.
    // var tiene scope de función y hoisting confuso — ambos son fuente de bugs.
    'no-var': 'error',

    // Si una variable declarada con let nunca se reasigna, debe ser const.
    // Evita mutaciones accidentales y comunica intención al lector.
    'prefer-const': 'error',

    // Error si una variable se declara pero no se usa.
    // args: 'after-used' → los parámetros anteriores al último usado están permitidos
    //   (ej: (req, res, next) — req puede ignorarse si solo usas res y next).
    // argsIgnorePattern/varsIgnorePattern: '^_' → prefijo _ indica "ignorado a propósito"
    //   (ej: _next en un middleware de error de Express).
    'no-unused-vars': [
      'error',
      {
        vars: 'all',
        args: 'after-used',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        ignoreRestSiblings: true
      }
    ],

    // Prohíbe declarar una variable con el mismo nombre que una del scope superior.
    // hoist: 'functions' → las funciones también se comprueban (no solo variables).
    // allow: [...] → excepciones para nombres muy comunes en Node/Express que de otro
    //   modo darían falsos positivos en cada callback y middleware.
    'no-shadow': [
      'error',
      {
        builtinGlobals: false,
        hoist: 'functions',
        allow: ['error', 'resolve', 'reject', 'next'],
        // `const user = await uow.run(async tx => { const user = …; return user; })`: la interna vive
        // en el inicializador de la externa (patrón del Unit of Work, docs/prisma-migration.md)
        ignoreOnInitialization: true
      }
    ],

    // Prohíbe usar una variable antes de declararla.
    // functions: false → las funciones declaradas con function f() {} tienen hoisting
    //   intencional y pueden llamarse antes de su declaración.
    // classes y variables sí se comprueban porque su hoisting no inicializa el valor.
    'no-use-before-define': [
      'error',
      {
        functions: false,
        classes: true,
        variables: true
      }
    ],

    // =========================================================================
    // §1.2 — FUNCIONES Y MÉTODOS
    // =========================================================================

    // Toda función marcada como async debe tener al menos un await interno.
    // Si no hay await, async es innecesario y puede confundir sobre el tipo de retorno.
    // Ver primer error que arreglamos hoy (_authenticateAfterRegister).
    'require-await': 'error',

    // return await foo() dentro de un async es redundante: el await externo
    // ya desenvuelve la Promise. La excepción válida es dentro de try/catch,
    // donde return await sí hace diferencia (captura errores del await).
    // ESLint permite esa excepción automáticamente.
    'no-return-await': 'error',

    // Los callbacks deben ser arrow functions, no function anónimas.
    // Las arrow functions heredan el this del scope exterior, evitando el
    // clásico bug de perder el contexto en callbacks.
    // allowUnboundThis: true → permite arrow functions que no usan this.
    'prefer-arrow-callback': [
      'error',
      {
        allowNamedFunctions: false,
        allowUnboundThis: true
      }
    ],

    // Dentro de new Promise((resolve, reject) => { ... }) no se puede usar return valor.
    // Solo resolve(valor) o reject(error). Un return accidental puede dejar la
    // Promise sin resolver silenciosamente.
    'no-promise-executor-return': 'error',

    // =========================================================================
    // §1.3 — CLASES
    // PascalCase está cubierto por el regex de id-match arriba.
    // =========================================================================

    // Los constructores no deben retornar un valor.
    // Su única responsabilidad es inicializar el objeto (this.x = ...).
    // Un return en un constructor puede cambiar qué devuelve new y es casi siempre un bug.
    'no-constructor-return': 'error',

    // =========================================================================
    // §1.4 — NOMBRES DE ARCHIVO
    // =========================================================================

    // Valida que el nombre de cada archivo sea kebab-case.
    // Ej: auth-register.service.js ✅  AuthRegister.js ❌
    // Requiere el plugin filenames-simple instalado.
    'filenames-simple/naming-convention': [
      'error',
      {
        rule: 'kebab-case'
      }
    ],

    // =========================================================================
    // §2.1 / §3.4 — STRICT MODE
    // =========================================================================

    // Exige 'use strict' como primera línea en todos los archivos.
    // Modo 'global' significa que debe estar al nivel del módulo, no dentro de funciones.
    // El propio .eslintrc.js está exento (ver overrides al final).
    strict: ['error', 'global'],

    // =========================================================================
    // §2.3 — LONGITUD DE FUNCIONES Y LÍNEAS
    // =========================================================================

    // Warn si una función supera 60 líneas (sin contar blancos ni comentarios).
    // Es warn y no error para no bloquear el CI, pero sí avisar que la función
    // probablemente está haciendo demasiado y debería dividirse.
    // IIFEs: false → las funciones autoinvocadas también cuentan.
    'max-lines-per-function': [
      'warn',
      {
        max: 90,
        skipBlankLines: true,
        skipComments: true,
        IIFEs: false
      }
    ],

    // Error si una línea supera 130 caracteres.
    // ignoreUrls: true → las URLs largas en comentarios no cuentan.
    // ignoreTemplateLiterals: true → un template literal largo (ej: query SQL) no corta.
    // ignoreStrings: false → los strings sí cuentan (deben partirse o moverse a constante).
    // ignoreComments: false → los comentarios largos también deben partirse.
    'max-len': [
      'error',
      {
        code: 130,
        ignoreUrls: true,
        ignoreStrings: false,
        ignoreTemplateLiterals: true,
        ignoreRegExpLiterals: true,
        ignoreComments: false,
        ignoreTrailingComments: true
      }
    ],

    // =========================================================================
    // §3.1 / §3.4 — ESTILO DE CÓDIGO
    // Nota: indentación, comillas, semicolons y trailing commas son
    // responsabilidad de Prettier (.prettierrc) — ESLint no los duplica
    // para evitar conflictos entre ambas herramientas.
    // =========================================================================

    // Prohíbe concatenación con +. Debe usarse template literal.
    // 'Hola ' + nombre ❌  →  `Hola ${nombre}` ✅
    'prefer-template': 'error',

    // Warn cuando se puede desestructurar un objeto y no se hace.
    // const id = req.params.id ❌  →  const { id } = req.params ✅
    // Solo aplica en declaraciones (VariableDeclarator), no en asignaciones,
    // porque la desestructuración en asignación a veces es menos legible.
    // array: false → no fuerza desestructuración de arrays (menos clara que índices).
    'prefer-destructuring': [
      'warn',
      {
        VariableDeclarator: { array: false, object: true },
        AssignmentExpression: { array: false, object: false }
      }
    ],

    // Siempre llaves {} en bloques if/else/for/while, aunque sean de una línea.
    // Evita bugs clásicos al añadir una segunda línea sin darse cuenta que ya no
    // pertenece al bloque.
    curly: ['error', 'all'],

    // Siempre === en lugar de ==.
    // null: 'ignore' → permite x == null como shorthand de
    //   x === null || x === undefined, que es un patrón común y legible.
    eqeqeq: ['error', 'always', { null: 'ignore' }],

    // Si un if termina en return, el else es código innecesario (el flujo
    // ya sale del if). allowElseIf: false → tampoco permite else if tras return.
    // Resultado: código más lineal y fácil de leer (early return pattern).
    'no-else-return': ['error', { allowElseIf: false }],

    // Todas las ramas de una función deben retornar un valor o ninguna debe hacerlo.
    // Mezclar return valor con return vacío es el error que arreglamos hoy
    // en notification-emitter.util.js.
    'consistent-return': 'error',

    // fn.apply(ctx, args) ❌  →  fn(...args) ✅
    // El spread es más legible y no requiere pasar el contexto explícitamente.
    'prefer-spread': 'error',

    // El objeto arguments es legado de ES5. Usar rest params es más explícito
    // y funciona con arrow functions (arguments no existe en ellas).
    // function f() { arguments } ❌  →  function f(...args) { args } ✅
    'prefer-rest-params': 'error',

    // =========================================================================
    // §3.4 — no-console
    // =========================================================================

    // En desarrollo: warn (puedes dejarlo temporalmente, pero se avisa).
    // En producción: error (el CI falla — todo logging debe pasar por Winston).
    // La lectura de NODE_ENV aquí es la única excepción permitida a no-process-env
    // porque ESLint no puede importar shared/constants.
    'no-console': isProduction ? 'error' : 'warn',

    // =========================================================================
    // §4.3 — MARCADORES ESPECIALES
    // =========================================================================

    // Warn si hay un TODO, FIXME, HACK o XXX al inicio de un comentario.
    // En dev y qa (todo lo que no sea producción) se desactiva: durante el
    // desarrollo estos marcadores son legítimos y no deben ensuciar el lint.
    // En producción sí se reportan, porque no deben llegar a la rama productiva.
    'no-warning-comments': isProduction
      ? [
          'warn',
          {
            terms: ['todo', 'fixme', 'hack', 'xxx'],
            location: 'start'
          }
        ]
      : 'off',

    // =========================================================================
    // §5.1 — MANEJO DE ERRORES
    // =========================================================================

    // Solo se puede hacer throw con instancias de Error o clases que la extienden.
    // throw 'mensaje' ❌  →  throw AppError.badRequest('...') ✅
    // Garantiza que todos los errores tengan stack trace.
    'no-throw-literal': 'error',

    // Prohíbe reasignar el parámetro completo (req = otracosa ❌).
    // props: false → permite mutar propiedades del parámetro (req.user = payload ✅),
    // que es el patrón estándar en middlewares de Express.
    'no-param-reassign': [
      'error',
      {
        props: false
      }
    ],

    // Prohíbe expresiones que no tienen efecto observable (resultado ignorado).
    // someVariable; ❌  o  a + b; ❌
    // allowShortCircuit: true → permite a && doSomething() como guard.
    // allowTernary: true → permite x ? a() : b() sin asignar el resultado.
    'no-unused-expressions': [
      'error',
      {
        allowShortCircuit: true,
        allowTernary: true,
        allowTaggedTemplates: false
      }
    ],

    // Warn si se usa un número literal sin asignarlo a una constante con nombre.
    // setTimeout(fn, 86400000) ❌  →  const ONE_DAY_MS = 86400000; setTimeout(fn, ONE_DAY_MS) ✅
    // La lista ignore contiene valores cuyo significado es obvio en contexto
    // (HTTP status codes, potencias de 2, milisegundos comunes, etc.).
    // enforceConst: true → la constante debe declararse con const, no let.
    // detectObjects: false → no revisa valores dentro de objetos literales
    //   (relajado porque las configs tienen muchos números en objetos).
    'no-magic-numbers': [
      'warn',
      {
        ignore: MAGIC_NUMBER_IGNORE,
        ignoreArrayIndexes: true,
        ignoreDefaultValues: true,
        enforceConst: true,
        detectObjects: false
      }
    ],

    // =========================================================================
    // §8.1 — ACCESO A process.env
    // =========================================================================

    // Prohíbe acceder a process.env directamente en cualquier archivo de la app.
    // Toda configuración debe llegar a través de shared/constants/ (config centralizado).
    // Los overrides al final de este archivo otorgan la excepción donde corresponde.
    'no-process-env': 'error',

    // =========================================================================
    // §9 — SEGURIDAD
    // =========================================================================

    // eval() ejecuta código arbitrario en el contexto actual — riesgo crítico de
    // inyección. Sin excepción posible.
    'no-eval': 'error',

    // Eval implícito: setTimeout("alert(1)", 100) — el string se evalúa como código.
    // También aplica a setInterval y execScript.
    'no-implied-eval': 'error',

    // new Function("return " + userInput) es eval disfrazado.
    'no-new-func': 'error',

    // __iterator__ y __proto__ son propiedades heredadas de versiones muy antiguas
    // de JS (SpiderMonkey). Su uso puede sobrescribir comportamientos internos
    // del motor y no está en el estándar.
    'no-iterator': 'error',
    'no-proto': 'error',

    // if (true) o while (1 === 1) suelen ser bugs o código de depuración olvidado.
    // checkLoops: false → while(true) está permitido para loops infinitos intencionales.
    'no-constant-condition': ['error', { checkLoops: false }],

    // Código después de return, throw, break o continue nunca se ejecuta.
    // Su presencia indica un bug (lógica equivocada) o código muerto olvidado.
    'no-unreachable': 'error',

    // =========================================================================
    // IMPORTS Y MÓDULOS
    // =========================================================================

    // Prohíbe importar el mismo módulo dos veces en el mismo archivo.
    // const a = require('x'); const b = require('x'); ❌
    // Se deben combinar en una sola importación.
    'no-duplicate-imports': 'error',

    // Prohíbe usar new sin asignar el resultado a una variable.
    // new MyService(); ❌  →  const svc = new MyService(); ✅
    // Un new sin asignación oculta side effects y hace el código difícil de testear.
    'no-new': 'error'
  },

  // ===========================================================================
  // OVERRIDES — reglas específicas por tipo de archivo
  // Permiten relajar reglas donde su aplicación estricta generaría más ruido
  // que valor (tests, documentación Swagger, etc.)
  // ===========================================================================
  overrides: [
    // -------------------------------------------------------------------------
    // Archivos de TEST (*.test.ts y tests/**)
    // En tests los valores concretos son intencionales (fixtures, assertions),
    // las funciones pueden ser largas (setup + AAA) y console.log es útil
    // para depurar tests en local.
    // -------------------------------------------------------------------------
    {
      files: ['**/*.test.{js,ts}', '**/tests/**/*.{js,ts}'],
      rules: {
        'max-lines-per-function': 'off', // Un describe con muchos it puede ser largo
        'max-len': 'off',
        'no-magic-numbers': 'off', // expect(res.status).toBe(404) debe permitirse
        'no-unused-expressions': 'off', // expect(...).toEqual(...) es una expresión sin return
        'no-console': 'off', // console.log para depurar tests en local
        'id-match': 'off' // _ solo y otros patrones de jest/test son válidos
      },
      globals: {
        PaginationHelper: 'writable' // Global de jest.setup — evita no-undef en tests
      }
    },

    // -------------------------------------------------------------------------
    // Módulo de constantes — ÚNICO lugar autorizado para leer process.env.
    // También se relajan los números mágicos porque config.js tiene muchos
    // valores por defecto numéricos que son semánticamente claros en contexto.
    // -------------------------------------------------------------------------
    {
      // prisma.config.ts y database-url.ts: el CLI de Prisma lee DB_* sin pasar por la validación completa
      files: ['**/shared/constants/**/*.{js,ts}', '**/shared/constants.js', '**/tests/**/*.{js,ts}', '**/shared/security/hash.util.{js,ts}', '**/*.test.ts', 'prisma.config.ts', '**/shared/database/database-url.ts'],
      rules: {
        'no-process-env': 'off',
        'no-magic-numbers': 'off'
      }
    },

    // -------------------------------------------------------------------------
    // Documentación Swagger
    // Los objetos de especificación OpenAPI son inherentemente verbosos y
    // largos. No tiene sentido aplicarles límites de líneas ni longitud.
    // -------------------------------------------------------------------------
    {
      files: ['**/swagger/**/*.{js,ts}', '**/docs/*.paths.ts', '**/swagger.admin.{js,ts}', '**/swagger.client.{js,ts}'],
      rules: {
        'max-lines-per-function': 'off',
        'max-len': 'off',
        'no-console': 'off',
        'no-magic-numbers': 'off' // Los enums OpenAPI son valores de documentación, no lógica
      }
    },

    // -------------------------------------------------------------------------
    // Archivos de configuración de BD y constants/config.js
    // Se permite console porque estos archivos se ejecutan durante el arranque,
    // antes de que Winston esté inicializado (el problema que arreglamos hoy).
    // -------------------------------------------------------------------------
    {
      files: ['**/config/database.{js,ts}', '**/constants/config.{js,ts}'],
      rules: {
        'no-console': 'off'
      }
    },

    // -------------------------------------------------------------------------
    // Datos del seed (templates de notificación, catálogos): funciones que solo
    // devuelven un literal largo.
    // -------------------------------------------------------------------------
    {
      files: ['prisma/seeds/notification-types/**', 'prisma/seeds/data/**'],
      rules: {
        'max-lines-per-function': 'off',
        'max-lines': 'off'
      }
    },

    // -------------------------------------------------------------------------
    // El propio .eslintrc.js
    // - strict off: los archivos de config de ESLint no son módulos de la app
    //   y no necesitan 'use strict'.
    // - no-process-env off: necesario para leer NODE_ENV sin importar constants
    //   (ver comentario al inicio del archivo).
    // -------------------------------------------------------------------------
    {
      files: ['.eslintrc.js'],
      rules: {
        strict: 'off',
        'no-process-env': 'off'
      }
    },

    // -------------------------------------------------------------------------
    // TypeScript (migración gradual — ver docs/typescript-migration.md)
    // Mismas reglas del proyecto + las recomendadas de typescript-eslint.
    // Las reglas base que TS ya cubre (o reporta mal sobre sintaxis de tipos)
    // se reemplazan por su versión de @typescript-eslint.
    // -------------------------------------------------------------------------
    {
      files: ['**/*.ts'],
      parser: '@typescript-eslint/parser',
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
      plugins: ['@typescript-eslint'],
      extends: ['plugin:@typescript-eslint/recommended', 'prettier'],
      rules: {
        'no-undef': 'off', // tsc ya detecta identificadores no definidos
        'no-unused-vars': 'off',
        '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
        'no-use-before-define': 'off',
        // require() solo queda para cargas diferidas (cortar ciclos), siempre vía interopDefault()
        '@typescript-eslint/no-require-imports': 'off',
        // Imports/exports nativos: `export =` e `import x = require()` eran el puente CommonJS de la
        // migración a TypeScript.
        'no-restricted-syntax': [
          'error',
          { selector: 'TSExportAssignment', message: 'Usar `export default` / `export` (ver docs/typescript-migration.md).' },
          { selector: 'TSImportEqualsDeclaration', message: "Usar `import x from 'm'` (ver docs/typescript-migration.md)." }
        ],
        // Los números en anotaciones de tipo / enums no son "mágicos"
        'no-magic-numbers': 'off',
        '@typescript-eslint/no-magic-numbers': [
          'warn',
          {
            ignore: MAGIC_NUMBER_IGNORE,
            ignoreArrayIndexes: true,
            ignoreDefaultValues: true,
            enforceConst: true,
            detectObjects: false,
            ignoreEnums: true,
            ignoreNumericLiteralTypes: true,
            ignoreReadonlyClassProperties: true
          }
        ],
        // `import type { X } from 'm'` junto a `import { y } from 'm'` es el patrón normal en TS
        'no-duplicate-imports': 'off'
      }
    },
    {
      files: ['**/tests/**/*.ts', '**/*.test.ts'],
      rules: {
        'max-lines-per-function': 'off',
        'max-len': 'off',
        '@typescript-eslint/no-magic-numbers': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
        // mockImplementation(async () => valor): la forma natural de un doble que devuelve una promesa
        'require-await': 'off'
      }
    },
    {
      // Esquemas de entrada (Zod): los límites (longitudes, rangos) son la especificación del campo, como en
      // la documentación OpenAPI; nombrar cada uno como constante no aporta.
      files: ['**/requests/*.ts', '**/shared/validation/*.ts'],
      rules: {
        'no-magic-numbers': 'off',
        '@typescript-eslint/no-magic-numbers': 'off'
      }
    }
  ]
};
