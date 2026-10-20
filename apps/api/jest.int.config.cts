/** Integrationstests gegen die Test-Datenbank (TEST_DATABASE_URL). */
module.exports = {
  displayName: 'api-int',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  testMatch: ['<rootDir>/src/**/*.int-spec.ts'],
  globalSetup: '<rootDir>/src/testing/global-setup.ts',
  setupFiles: ['<rootDir>/src/testing/env-setup.ts'],
  maxWorkers: 1,
  testTimeout: 30000,
};
