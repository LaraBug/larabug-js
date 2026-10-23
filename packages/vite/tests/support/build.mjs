// Runs one real `vite build` of a Laravel app with the plugin, in its own
// process because Vite is ESM. Usage: node build.mjs <plugin entry> <options json> [ssr|serve]
// `serve` starts the dev server instead, and stops it once it listens.
import { build, createServer } from 'vite';
import laravel from 'laravel-vite-plugin';

const [pluginEntry, options, mode] = process.argv.slice(2);
const { larabug } = await import(pluginEntry);

const config = {
  configFile: false,
  root: process.cwd(),
  logLevel: 'info',
  plugins: [
    laravel({ input: ['resources/js/app.js'], ssr: 'resources/js/ssr.js' }),
    larabug(JSON.parse(options)),
  ],
};

if (mode === 'serve') {
  const server = await createServer({ ...config, server: { port: 0 } });
  await server.listen();
  await server.transformRequest('/resources/js/app.js');
  await server.close();
} else {
  await build({ ...config, build: mode === 'ssr' ? { ssr: true } : {} });
}
