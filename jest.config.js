/** @type {import('jest').Config} */

const sharedConfig = {
  testEnvironment: 'node',
  workerIdleMemoryLimit: '512MB',
  setupFiles: ['<rootDir>/tests/jest.setup.env.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
  // `jose` (usado por jwt.util) se publica como ESM puro; Node lo carga con
  // require(ESM), pero el loader de Jest no. Es el único .js que se transpila
  // (todo lo demás en node_modules se sigue ignorando por rendimiento).
  transformIgnorePatterns: ['/node_modules/(?!(jose)/)'],
  // ts-jest solo transpila (isolatedModules): los tipos los revisa `npm run typecheck`.
  transform: {
    '^.+\\.ts$': ['ts-jest', { isolatedModules: true, tsconfig: '<rootDir>/tsconfig.test.json' }],
    // ESM → CommonJS para jose (el único .js que transformIgnorePatterns deja pasar); allowJs solo
    // para este transform: el proyecto es TS (allowJs false)
    '^.+\\.js$': [
      'ts-jest',
      { isolatedModules: true, tsconfig: { allowJs: true, module: 'commonjs', target: 'ES2023' } }
    ]
  },
  moduleFileExtensions: ['ts', 'js', 'json', 'node'], // js: dependencias de node_modules
  clearMocks: true,
  resetMocks: false,
  restoreMocks: false,
  moduleNameMapper: {
    '^tests/helpers$': '<rootDir>/tests/helpers/index.ts',
    '^tests/helpers/(.*)$': '<rootDir>/tests/helpers/$1'
  }
};

module.exports = {
  ...sharedConfig,

  testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/tests/**/*.test.ts'],

  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/**/generated/**',
    '!src/**/docs/**',
    '!src/config/**',
    '!src/app.ts',
    '!src/server.ts'
  ],

  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'text-summary', 'lcov', 'html'],

  testTimeout: 10000,

  projects: [
    {
      ...sharedConfig,
      displayName: 'unit',
      testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/tests/unit/**/*.test.ts'],
      maxWorkers: 3
    },
    {
      ...sharedConfig,
      displayName: 'integration',
      testMatch: ['<rootDir>/tests/integration/**/*.test.ts'],
      maxWorkers: 1
    }
  ],

  // Termina Jest sin esperar a que handles abiertos cierren (setInterval del HybridStore)
  forceExit: true
};
