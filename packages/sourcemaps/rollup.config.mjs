import { builtinModules } from 'node:module';
import { readFileSync } from 'node:fs';
import typescript from '@rollup/plugin-typescript';
import replace from '@rollup/plugin-replace';
import dts from 'rollup-plugin-dts';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const core = JSON.parse(readFileSync(new URL('../core/package.json', import.meta.url), 'utf8'));
const external = [
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
  ...Object.keys(pkg.dependencies ?? {}),
];

// After typescript, so the declarations of the placeholders are gone by then.
const versions = replace({
  preventAssignment: true,
  values: {
    // The JavaScript SDK this package was released with, for the X-LaraBug-Sdk header.
    __LARABUG_CORE_VERSION__: JSON.stringify(core.version),
    __LARABUG_SOURCEMAPS_VERSION__: JSON.stringify(pkg.version),
  },
});

const config = [
  {
    input: 'src/index.ts',
    external,
    output: [
      { file: 'dist/index.js', format: 'cjs', sourcemap: true },
      { file: 'dist/index.mjs', format: 'esm', sourcemap: true },
    ],
    plugins: [
      typescript({ tsconfig: './tsconfig.json', declaration: false, declarationMap: false }),
      versions,
    ],
  },
  {
    input: 'src/bin.ts',
    external,
    output: { file: 'dist/bin.js', format: 'cjs', banner: '#!/usr/bin/env node' },
    plugins: [
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
        declarationMap: false,
        sourceMap: false,
      }),
      versions,
    ],
  },
  {
    input: 'src/index.ts',
    external,
    output: { file: 'dist/index.d.ts', format: 'es' },
    plugins: [dts()],
  },
];

export default config;
