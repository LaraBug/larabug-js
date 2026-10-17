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
    // Vite and Inertia v3 ship their types behind package exports only, which needs node16
    // resolution, which ts-jest supports only with isolatedModules: these files
    // are transpiled without type checks, and `tsc -p packages/vite` checks them.
    '^.+/packages/(vite|inertia|vue)/.+\\.ts$': [
      'ts-jest',
      { tsconfig: '<rootDir>/packages/vite/tsconfig.test.json' },
    ],
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
  testEnvironment: 'node',
  clearMocks: true,
};
