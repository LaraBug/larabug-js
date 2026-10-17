import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * The variables a build sees: `.env` files in `dir` with the same precedence as
 * Vite (`.env`, `.env.local`, `.env.[mode]`, `.env.[mode].local`, later wins),
 * then the process environment over all of them. `${NAME}` references are
 * expanded, which Laravel's `.env` uses for `VITE_*` variables.
 */
export function loadEnv(dir: string, mode?: string): Record<string, string> {
  const files = ['.env', '.env.local'];
  if (mode) {
    files.push(`.env.${mode}`, `.env.${mode}.local`);
  }

  const fromFiles: Record<string, string> = {};
  for (const file of files) {
    const path = join(dir, file);
    if (existsSync(path)) {
      Object.assign(fromFiles, parseEnv(readFileSync(path, 'utf8')));
    }
  }

  const fromProcess: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      fromProcess[name] = value;
    }
  }

  const merged = { ...fromFiles, ...fromProcess };

  for (const name of Object.keys(fromFiles)) {
    if (!(name in fromProcess)) {
      merged[name] = expand(merged[name], merged, new Set([name]));
    }
  }

  return merged;
}

export function parseEnv(source: string): Record<string, string> {
  const result: Record<string, string> = {};
  const line = /^\s*(?:export\s+)?([\w.-]+)\s*=\s*("(?:\\.|[^"\\])*"|'[^']*'|[^\n]*?)\s*(?:#.*)?$/;

  for (const raw of source.split(/\r?\n/)) {
    const match = raw.match(line);
    if (!match) {
      continue;
    }

    let value = match[2];
    if (value.startsWith('"')) {
      value = value
        .slice(1, -1)
        .replace(/\\n/g, '\n')
        .replace(/\\(["\\])/g, '$1');
    } else if (value.startsWith("'")) {
      value = value.slice(1, -1);
    }

    result[match[1]] = value;
  }

  return result;
}

function expand(value: string, env: Record<string, string>, seen: Set<string>): string {
  return value.replace(/\$\{([\w.-]+)\}/g, (_, name: string) => {
    if (seen.has(name) || env[name] === undefined) {
      return '';
    }

    return expand(env[name], env, new Set([...seen, name]));
  });
}
