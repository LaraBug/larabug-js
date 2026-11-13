import { readFileSync } from 'node:fs';
import typescript from '@rollup/plugin-typescript';
import replace from '@rollup/plugin-replace';
import dts from 'rollup-plugin-dts';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const config = [
  {
    input: 'src/index.ts',
    output: [
      {
        file: 'dist/index.js',
        format: 'cjs',
        sourcemap: true,
      },
      {
        file: 'dist/index.esm.js',
        format: 'esm',
        sourcemap: true,
      },
    ],
    plugins: [
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
      }),
      // After typescript, so the declaration of the placeholder is gone by then.
      replace({
        preventAssignment: true,
        values: { __LARABUG_CORE_VERSION__: JSON.stringify(pkg.version) },
      }),
    ],
  },
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.d.ts',
      format: 'es',
    },
    plugins: [dts()],
  },
];

export default config;
