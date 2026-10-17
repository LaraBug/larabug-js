// Runs one real `vite build` of a Laravel app with the plugin, in its own
// process because Vite is ESM. Usage: node build.mjs <plugin entry> <options json> [ssr]
import { build } from 'vite';
import laravel from 'laravel-vite-plugin';

const [pluginEntry, options, ssr] = process.argv.slice(2);
const { larabug } = await import(pluginEntry);

await build({
  configFile: false,
  root: process.cwd(),
  logLevel: 'info',
  plugins: [
    laravel({ input: ['resources/js/app.js'], ssr: 'resources/js/ssr.js' }),
    larabug(JSON.parse(options)),
  ],
  build: ssr === 'ssr' ? { ssr: true } : {},
});
