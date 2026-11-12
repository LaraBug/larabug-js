import type { Delivery, Outbox, RetryBufferOptions } from '@larabug/core';

/** A kept report: id, created at, failed attempts, not before (epoch ms), and the encoded report. */
interface Entry {
  id: string;
  t: number;
  n: number;
  at: number;
  body: string;
}

function isEntry(value: any): value is Entry {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.id === 'string' &&
    typeof value.body === 'string' &&
    typeof value.t === 'number' &&
    typeof value.n === 'number' &&
    typeof value.at === 'number'
  );
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** localStorage when it can be written to. Private modes and sandboxed frames throw on it. */
function localStorageOrNull(): Storage | null {
  try {
    const storage = window.localStorage;
    storage.setItem('larabug:probe', '1');
    storage.removeItem('larabug:probe');
    return storage;
  } catch {
    return null;
  }
}

/** A short, stable name for a string, so the storage key does not carry a credential. */
function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h, 33) ^ text.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

/**
 * Keeps the reports the endpoint could not take, in localStorage (in memory
 * when that is unavailable or full), and sends them later: on the next page
 * load, when the browser comes back online, after the next report that goes
 * through, and on a timer, each time with backoff.
 *
 * Every tab of an origin shares the queue, so a short lock in localStorage
 * keeps two tabs from sending the same report. Nothing in here ever throws.
 */
export class RetryBuffer implements Outbox {
  private storage: Storage | null = localStorageOrNull();
  private memory: Entry[] = [];
  private readonly key: string;
  private readonly owner = Math.random().toString(36).slice(2);
  private count = 0;
  private flushing = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  /**
   * `scope` tells apart the queues of two projects reporting from one origin.
   * `send` posts one report, once.
   */
  constructor(
    private readonly send: (payload: string) => Promise<Delivery>,
    private readonly limits: Required<RetryBufferOptions>,
    scope: string
  ) {
    this.key = `larabug:retry:${hash(scope)}`;
  }

  defer(payload: string, attempts: number, notBefore: number): void {
    try {
      const now = Date.now();
      this.update((entries) =>
        entries.concat({
          id: `${this.owner}.${++this.count}`,
          t: now,
          n: attempts,
          at: Math.max(notBefore, attempts ? now + this.backoff(attempts) : now),
          body: payload,
        })
      );
      this.schedule();
    } catch {
      // The report is lost, as it was before there was a buffer.
    }
  }

  delivered(): void {
    // The endpoint just took a report, so the kept ones need not wait.
    void this.flush(true);
  }

  /** Send what is due, oldest first, until one fails. `force` sends what is not due yet too. */
  async flush(force = false): Promise<void> {
    if (this.flushing || isOffline()) {
      return;
    }

    this.flushing = true;

    try {
      for (;;) {
        const now = Date.now();
        const entry = this.read().find((candidate) => force || candidate.at <= now);

        if (!entry || !this.lock()) {
          break;
        }

        const result = await this.send(entry.body);
        const keep = result.outcome === 'failed' && result.deferrable;

        this.update((entries) =>
          keep
            ? entries.map((kept) =>
                kept.id === entry.id
                  ? {
                      ...kept,
                      n: kept.n + 1,
                      at: Math.max(result.notBefore, Date.now() + this.backoff(kept.n + 1)),
                    }
                  : kept
              )
            : entries.filter((kept) => kept.id !== entry.id)
        );

        if (keep) {
          break;
        }
      }
    } catch {
      // Storage or the network misbehaved; whatever is left waits for the next try.
    } finally {
      this.unlock();
      this.flushing = false;
      this.schedule();
    }
  }

  /** Set a timer for the next report that falls due. Offline, the online event takes over. */
  schedule(): void {
    try {
      clearTimeout(this.timer);
      const entries = this.read();

      if (entries.length === 0 || isOffline()) {
        return;
      }

      const next = Math.min(...entries.map((entry) => entry.at)) - Date.now();
      this.timer = setTimeout(() => void this.flush(), Math.min(Math.max(next, 1000), 3_600_000));
    } catch {
      // No timer; the next page load, online event or delivered report flushes instead.
    }
  }

  /** 15 seconds after the first failure, doubling up to an hour, with jitter. */
  private backoff(attempts: number): number {
    const ms = Math.min(3_600_000, 15_000 * 2 ** (attempts - 1));
    return ms / 2 + (Math.random() * ms) / 2;
  }

  private read(): Entry[] {
    if (!this.storage) {
      return this.memory;
    }

    try {
      const parsed = JSON.parse(this.storage.getItem(this.key) || '[]');
      return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
    } catch {
      return [];
    }
  }

  /** Read, change and write the queue in one go, so another tab's reports survive. */
  private update(change: (entries: Entry[]) => Entry[]): void {
    const kept = this.bound(change(this.read()));

    if (this.storage) {
      try {
        if (kept.length) {
          this.storage.setItem(this.key, JSON.stringify(kept));
        } else {
          this.storage.removeItem(this.key);
        }
        return;
      } catch {
        // Full or gone. Keep the queue in memory from here on, and remove the
        // stored copy so that a later page load does not send it a second time.
        try {
          this.storage.removeItem(this.key);
        } catch {
          // Nothing more to do.
        }
        this.storage = null;
      }
    }

    this.memory = kept;
  }

  /** Drop what is too old, then the oldest until the queue fits its count and size. */
  private bound(entries: Entry[]): Entry[] {
    const now = Date.now();
    const kept = entries
      .filter((entry) => now - entry.t < this.limits.maxAgeMs)
      .sort((a, b) => a.t - b.t);
    let bytes = kept.reduce((sum, entry) => sum + entry.body.length, 0);

    while (kept.length && (kept.length > this.limits.maxReports || bytes > this.limits.maxBytes)) {
      bytes -= kept.shift()!.body.length;
    }

    return kept;
  }

  /** Take or renew the lock. False while another tab holds it. Memory needs none. */
  private lock(): boolean {
    if (!this.storage) {
      return true;
    }

    const [holder, until] = (this.storage.getItem(`${this.key}:lock`) || '').split(' ');

    if (holder && holder !== this.owner && Number(until) > Date.now()) {
      return false;
    }

    this.storage.setItem(`${this.key}:lock`, `${this.owner} ${Date.now() + 30_000}`);
    return true;
  }

  private unlock(): void {
    try {
      if (this.storage?.getItem(`${this.key}:lock`)?.startsWith(`${this.owner} `)) {
        this.storage.removeItem(`${this.key}:lock`);
      }
    } catch {
      // The lock expires on its own.
    }
  }
}
