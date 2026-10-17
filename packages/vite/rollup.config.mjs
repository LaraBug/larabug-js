import { builtinModules } from 'node:module';
import { readFileSync } from 'node:fs';
import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const external = [
  'vite',
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
  ...Object.keys(pkg.dependencies ?? {}),
];

const config = [
  {
    input: 'src/index.ts',
    external,
    output: [
      { file: 'dist/index.js', format: 'cjs', sourcemap: true, exports: 'named' },
      { file: 'dist/index.mjs', format: 'esm', sourcemap: true },
    ],
    plugins: [
      typescript({ tsconfig: './tsconfig.json', declaration: false, declarationMap: false }),
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
