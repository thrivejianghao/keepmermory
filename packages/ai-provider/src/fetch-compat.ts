import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

// Node's built-in fetch requires WebAssembly, which is unavailable with --jitless.
export const compatibleFetch: typeof fetch = typeof WebAssembly === 'undefined' ? nodeFetch : fetch;

async function nodeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  const body = request.body ? Buffer.from(await request.arrayBuffer()) : undefined;
  return send(request, body, 0);
}

function send(input: Request, body: Buffer | undefined, redirects: number): Promise<Response> {
  const target = new URL(input.url);
  if (!['http:', 'https:'].includes(target.protocol)) return Promise.reject(new Error('FETCH_UNSUPPORTED_PROTOCOL'));
  if (input.signal.aborted) return Promise.reject(new Error('FETCH_ABORTED'));
  return new Promise((resolve, reject) => {
    const transport = target.protocol === 'https:' ? httpsRequest : httpRequest;
    const request = transport(target, { method: input.method, headers: Object.fromEntries(input.headers) }, (response) => {
      const status = response.statusCode ?? 500;
      const location = response.headers.location;
      if (location && [301, 302, 303, 307, 308].includes(status) && input.redirect !== 'manual') {
        response.resume();
        if (input.redirect === 'error' || redirects >= 5) { reject(new Error('FETCH_REDIRECT_FAILED')); return; }
        let next: URL;
        try { next = new URL(location, target); } catch { reject(new Error('FETCH_REDIRECT_FAILED')); return; }
        if (target.protocol === 'https:' && next.protocol !== 'https:') { reject(new Error('FETCH_INSECURE_REDIRECT')); return; }
        const headers = new Headers(input.headers);
        if (next.origin !== target.origin) {
          headers.delete('authorization');
          headers.delete('x-goog-api-key');
          headers.delete('cookie');
        }
        const toGet = (status === 303 && input.method !== 'HEAD') || ([301, 302].includes(status) && input.method === 'POST');
        if (toGet) { headers.delete('content-type'); headers.delete('content-length'); }
        try {
          const nextRequest = new Request(next, { method: toGet ? 'GET' : input.method, headers, signal: input.signal, redirect: input.redirect });
          resolve(send(nextRequest, toGet ? undefined : body, redirects + 1));
        } catch { reject(new Error('FETCH_REDIRECT_FAILED')); }
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 40 * 1024 * 1024) request.destroy(new Error('FETCH_RESPONSE_TOO_LARGE'));
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) value.forEach((entry) => headers.append(name, entry));
          else if (value !== undefined) headers.set(name, value);
        }
        try {
          resolve(new Response([204, 205, 304].includes(status) || input.method === 'HEAD' ? null : Buffer.concat(chunks), { status, headers }));
        } catch { reject(new Error('FETCH_INVALID_RESPONSE')); }
      });
    });
    const abort = () => request.destroy(new Error('FETCH_ABORTED'));
    input.signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => request.destroy(new Error('FETCH_TIMEOUT')), 120000);
    request.once('close', () => { clearTimeout(timeout); input.signal.removeEventListener('abort', abort); });
    request.on('error', (cause) => reject(new TypeError('fetch failed', { cause })));
    if (body) request.write(body);
    request.end();
  });
}
