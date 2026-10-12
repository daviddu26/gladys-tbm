// -----------------------------------------------------------------------------
// Tests never touch the network: `fetch` is replaced by a router answering the
// SIRI-Lite method found in the URL, and recording every call.
// -----------------------------------------------------------------------------

import { linesPayload, stopMonitoringPayload, stopPointsPayload } from './fixtures.js';

/**
 * Replace the global fetch for the duration of a test.
 * @param {import('node:test').TestContext} t
 * @param {Record<string, unknown | ((url: URL) => unknown)>} [overrides]
 *   per SIRI method ('stop-monitoring'...): a payload, a function of the URL,
 *   or an Error to throw, or `{ status }` for an HTTP error
 * @returns {{ calls: URL[] }}
 */
export function stubFetch(t, overrides = {}) {
  const routes = {
    'stoppoints-discovery': stopPointsPayload,
    'lines-discovery': linesPayload,
    'stop-monitoring': () => stopMonitoringPayload(),
    ...overrides,
  };
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    const method = url.pathname
      .split('/')
      .pop()
      .replace(/\.json$/, '');
    if (!(method in routes)) {
      return new Response('not found', { status: 404 });
    }
    const route = routes[method];
    const payload = typeof route === 'function' ? route(url) : route;
    if (payload instanceof Error) throw payload;
    if (payload && typeof payload === 'object' && 'status' in payload && !('Siri' in payload)) {
      return new Response('error', { status: payload.status });
    }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return { calls };
}
