/**
 * Tests run against `src`, not `dist`: the packages resolve each other through
 * moduleNameMapper so a test never depends on a build having happened first.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  roots: ['<rootDir>/packages'],
  testMatch: ['**/tests/**/*.test.ts'],
  moduleNameMapper: {
    '^@larabug/core$': '<rootDir>/packages/core/src',
    '^@larabug/browser$': '<rootDir>/packages/browser/src',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
  testEnvironment: 'node',
  clearMocks: true,
};
