const version = (name) => require(`./packages/${name}/package.json`).version;

/** @type {import('jest').Config} */
module.exports = {
  // What each package's rollup build puts in place of these placeholders.
  globals: {
    __LARABUG_CORE_VERSION__: version('core'),
    __LARABUG_SOURCEMAPS_VERSION__: version('sourcemaps'),
    __LARABUG_VITE_VERSION__: version('vite'),
  },
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
