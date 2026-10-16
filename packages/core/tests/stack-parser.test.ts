import { parseStackTrace } from '../src';

const bundle = 'https://app.test/build/assets/app-D4wpJuT4.js';

describe('V8 stacks (Chrome, Edge, Opera)', () => {
  it('keeps the full URL, the line and the column of every frame', () => {
    const frames = parseStackTrace(
      [
        'TypeError: Cannot read properties of undefined (reading \'id\')',
        `    at Proxy.save (${bundle}:1:23456)`,
        `    at ${bundle}:1:789`,
        `    at async Promise.all (index 0)`,
        `    at async load (${bundle}:2:42)`,
      ].join('\n')
    );

    expect(frames).toEqual([
      { function: 'Proxy.save', filename: bundle, lineno: 1, colno: 23456, in_app: true },
      { function: '<anonymous>', filename: bundle, lineno: 1, colno: 789, in_app: true },
      { function: 'Promise.all', filename: 'index 0', in_app: false },
      { function: 'load', filename: bundle, lineno: 2, colno: 42, in_app: true },
    ]);
  });

  it('keeps a port as part of the URL', () => {
    const [frame] = parseStackTrace('Error: x\n    at run (http://localhost:5173/resources/js/app.js:10:20)');

    expect(frame).toMatchObject({ filename: 'http://localhost:5173/resources/js/app.js', lineno: 10, colno: 20 });
  });

  it('points an eval frame at the code that called eval', () => {
    const [frame] = parseStackTrace(
      `Error: x\n    at eval (eval at run (${bundle}:3:7), <anonymous>:1:1)`
    );

    expect(frame).toMatchObject({ function: 'eval', filename: bundle, lineno: 3, colno: 7 });
  });

  it('marks dependencies as not in the app', () => {
    const [frame] = parseStackTrace('Error: x\n    at f (https://app.test/node_modules/.vite/deps/vue.js:1:2)');

    expect(frame.in_app).toBe(false);
  });

  it('does not mistake the message line for a frame', () => {
    expect(parseStackTrace('Error: timed out after 3:20')).toEqual([]);
  });
});

describe('SpiderMonkey stacks (Firefox)', () => {
  it('keeps the top frame, which has no message line above it', () => {
    const frames = parseStackTrace(
      [`save@${bundle}:1:23456`, `@${bundle}:1:789`, `promise callback*load@${bundle}:2:42`, ''].join('\n')
    );

    expect(frames).toEqual([
      { function: 'save', filename: bundle, lineno: 1, colno: 23456, in_app: true },
      { function: '<anonymous>', filename: bundle, lineno: 1, colno: 789, in_app: true },
      { function: 'load', filename: bundle, lineno: 2, colno: 42, in_app: true },
    ]);
  });

  it('points an eval frame at the line that called eval', () => {
    const [frame] = parseStackTrace(`run@${bundle} line 3 > eval:1:1`);

    expect(frame).toMatchObject({ function: 'run', filename: bundle, lineno: 3 });
  });
});

describe('JavaScriptCore stacks (Safari)', () => {
  it('keeps URLs and columns, and native frames without either', () => {
    const frames = parseStackTrace(
      [`save@${bundle}:1:23456`, 'forEach@[native code]', `global code@${bundle}:1:5`, `${bundle}:1:9`].join('\n')
    );

    expect(frames).toEqual([
      { function: 'save', filename: bundle, lineno: 1, colno: 23456, in_app: true },
      { function: 'forEach', filename: '[native code]', in_app: false },
      { function: 'global code', filename: bundle, lineno: 1, colno: 5, in_app: true },
      { function: '<anonymous>', filename: bundle, lineno: 1, colno: 9, in_app: true },
    ]);
  });
});

describe('parseStackTrace', () => {
  it('returns no frames for anything that is not a stack', () => {
    expect(parseStackTrace(undefined)).toEqual([]);
    expect(parseStackTrace('')).toEqual([]);
    expect(parseStackTrace(42)).toEqual([]);
  });

  it('caps a runaway stack', () => {
    const stack = Array.from({ length: 500 }, (_, i) => `f${i}@${bundle}:1:${i}`).join('\n');

    expect(parseStackTrace(stack)).toHaveLength(50);
  });
});
