import { StackFrame } from './types';

/**
 * Turns `error.stack` into frames, for every engine LaraBug supports.
 *
 * Source maps resolve a frame by its exact script URL, line and column, so a
 * frame without a column, or with a URL cut short, cannot be symbolicated.
 * Each engine formats the stack its own way:
 *
 *   V8 (Chrome, Edge, Opera, Node)
 *     "    at handler (https://app.test/build/assets/app-D4wpJuT4.js:1:2345)"
 *     "    at https://app.test/build/assets/app-D4wpJuT4.js:1:2345"
 *     "    at async load (https://app.test/build/assets/app-D4wpJuT4.js:1:2345)"
 *     "    at eval (eval at run (https://app.test/app.js:3:7), <anonymous>:1:1)"
 *
 *   SpiderMonkey (Firefox) and JavaScriptCore (Safari)
 *     "handler@https://app.test/build/assets/app-D4wpJuT4.js:1:2345"
 *     "@https://app.test/build/assets/app-D4wpJuT4.js:1:2345"
 *     "promise callback*handler@https://app.test/app.js:1:2345"
 *     "run@https://app.test/app.js line 3 > eval:1:1"
 *     "global code@https://app.test/app.js:1:2345"
 *     "forEach@[native code]"
 *
 * Firefox and Safari leave the message out of `error.stack` while V8 puts it on
 * the first line, so no line is skipped by position: a line that is not a
 * frame simply does not match.
 */

const MAX_FRAMES = 50;

// "at" then an optional function name, then a location that is either wrapped
// in parentheses or bare.
const V8_FRAME = /^\s*at\s+(?:(.*?)\s+\((.+?)\)|(.+?))\s*$/;

// An optional function name, "@", then the location.
const GECKO_FRAME = /^\s*(.*?)@(.*?)\s*$/;

// Anchored at the end, so a port ("localhost:5173") stays part of the URL.
const LOCATION = /^(.*?):(\d+)(?::(\d+))?$/;

// What V8 writes for an eval'd frame: the location that matters is the one of
// the code that called eval, the first "(url:line:col)" inside it.
const V8_EVAL_CALLER = /\(([^()\s]+:\d+:\d+)\)/;

// Firefox writes "url line N > eval" (or "> Function") for eval'd code.
const GECKO_EVAL = /^(.*?) line (\d+)(?: > (?:eval|Function))+.*$/;

export function parseStackTrace(stack: unknown): StackFrame[] {
  if (typeof stack !== 'string' || stack === '') {
    return [];
  }

  const frames: StackFrame[] = [];

  for (const line of stack.split('\n')) {
    if (frames.length >= MAX_FRAMES) {
      break;
    }

    const frame = parseStackLine(line);
    if (frame) {
      frames.push(frame);
    }
  }

  return frames;
}

export function parseStackLine(line: string): StackFrame | null {
  // Very long lines are minified source pasted into a message, never a frame.
  if (line.length > 1024) {
    return null;
  }

  const v8 = line.match(V8_FRAME);
  if (v8) {
    return parseV8(v8[1], v8[2] ?? v8[3]);
  }

  const gecko = line.match(GECKO_FRAME);
  if (gecko) {
    return parseGecko(gecko[1], gecko[2]);
  }

  // Old Safari and some WebViews print a bare location for anonymous frames.
  return locationFrame('<anonymous>', line.trim());
}

function parseV8(name: string | undefined, location: string): StackFrame | null {
  let fn = (name || '').replace(/^async\s+/, '').trim();
  let where = location.trim();

  // "at Promise.all (index 0)" and "at new Promise (<anonymous>)" are engine
  // internals with nothing to map.
  if (where === '<anonymous>' || where === 'native' || /^index \d+$/.test(where)) {
    return nativeFrame(fn || '<anonymous>', where);
  }

  if (where.startsWith('eval at ')) {
    const caller = where.match(V8_EVAL_CALLER);
    if (caller) {
      where = caller[1];
      fn = fn || 'eval';
    }
  }

  // A bare "at async https://..." frame: the async marker was not separated
  // from the location by a name.
  where = where.replace(/^async\s+/, '');

  return locationFrame(fn || '<anonymous>', where);
}

function parseGecko(name: string, location: string): StackFrame | null {
  const fn = cleanGeckoName(name);
  const where = location.trim();

  if (where === '[native code]') {
    return nativeFrame(fn, where);
  }

  const evalMatch = where.match(GECKO_EVAL);
  if (evalMatch) {
    return {
      function: fn === '<anonymous>' ? 'eval' : fn,
      filename: evalMatch[1],
      lineno: parseInt(evalMatch[2], 10),
      in_app: isInApp(evalMatch[1]),
    };
  }

  return locationFrame(fn, where);
}

// "promise callback*handler" and "setTimeout handler*run": the part before the
// asterisk says how the frame was scheduled, not which function it is.
function cleanGeckoName(name: string): string {
  const trimmed = name.includes('*') ? name.slice(name.lastIndexOf('*') + 1) : name;

  // Safari names top level code "global code" and module code "module code".
  return trimmed.trim() || '<anonymous>';
}

function locationFrame(fn: string, location: string): StackFrame | null {
  const match = location.match(LOCATION);
  if (!match || !looksLikeAFile(match[1])) {
    return null;
  }

  const frame: StackFrame = {
    function: fn,
    filename: match[1],
    lineno: parseInt(match[2], 10),
    in_app: isInApp(match[1]),
  };

  if (match[3] !== undefined) {
    frame.colno = parseInt(match[3], 10);
  }

  return frame;
}

function nativeFrame(fn: string, filename: string): StackFrame {
  return { function: fn, filename, in_app: false };
}

/**
 * A URL, an absolute path, or a script name. Rules out message lines such as
 * "Error: timed out after 3:20" that happen to end in numbers.
 */
function looksLikeAFile(candidate: string): boolean {
  if (/^[a-z][\w+.-]*:\/\//i.test(candidate)) {
    return true;
  }

  if (candidate === '' || /\s/.test(candidate)) {
    return false;
  }

  return (
    /^[a-z][\w+.-]*:/i.test(candidate) ||
    candidate.startsWith('/') ||
    candidate.startsWith('<') ||
    /\.[cm]?[jt]sx?$|\.vue$|\.svelte$/.test(candidate)
  );
}

function isInApp(filename: string): boolean {
  return !filename.includes('/node_modules/') && !filename.includes('/vendor/');
}
