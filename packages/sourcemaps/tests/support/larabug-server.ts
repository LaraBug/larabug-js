import { createServer, IncomingHttpHeaders, Server } from 'http';
import { AddressInfo } from 'net';

export interface ReceivedUpload {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  fields: Record<string, string>;
  sourcemap?: { filename: string; type: string; content: string };
}

export interface ScriptedResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * A stand-in for the LaraBug host on 127.0.0.1. Records every request with its
 * multipart form parsed, and answers from a script of responses (201 once the
 * script runs out).
 */
export class LaraBugServer {
  readonly requests: ReceivedUpload[] = [];
  private script: ScriptedResponse[] = [];
  private server: Server;

  constructor() {
    this.server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', async () => {
        const received: ReceivedUpload = {
          method: request.method ?? '',
          path: request.url ?? '',
          headers: request.headers,
          fields: {},
        };

        const body = Buffer.concat(chunks);
        if (
          body.length > 0 &&
          String(request.headers['content-type']).startsWith('multipart/form-data')
        ) {
          const form = await new Response(body, {
            headers: { 'content-type': String(request.headers['content-type']) },
          }).formData();

          for (const [name, value] of form.entries()) {
            if (typeof value === 'string') {
              received.fields[name] = value;
            } else {
              received.sourcemap = {
                filename: value.name,
                type: value.type,
                content: await value.text(),
              };
            }
          }
        }

        this.requests.push(received);

        const next = this.script.shift() ?? { status: 201, body: { status: 'created' } };
        response.writeHead(next.status, { 'content-type': 'application/json', ...next.headers });
        response.end(JSON.stringify(next.body ?? {}));
      });
    });
  }

  /** The responses for the next requests, in order. */
  respondWith(...responses: ScriptedResponse[]): this {
    this.script.push(...responses);
    return this;
  }

  get host(): string {
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  start(): Promise<this> {
    return new Promise((resolve) => this.server.listen(0, '127.0.0.1', () => resolve(this)));
  }

  stop(): Promise<void> {
    // fetch keeps connections alive, and close() would wait on them.
    this.server.closeAllConnections();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
}

/** A host where nothing listens, for connection failures. */
export async function deadHost(): Promise<string> {
  const server = await new LaraBugServer().start();
  const host = server.host;
  await server.stop();
  return host;
}
