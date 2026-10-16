/** @type {import('jest').Config} */
module.exports = {
  roots: ['<rootDir>/packages'],
  testMatch: ['**/tests/**/*.test.ts'],
  moduleNameMapper: {
    '^@larabug/core$': '<rootDir>/packages/core/src',
    '^@larabug/browser$': '<rootDir>/packages/browser/src',
    '^@larabug/sourcemaps$': '<rootDir>/packages/sourcemaps/src',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
  testEnvironment: 'node',
  clearMocks: true,
};
