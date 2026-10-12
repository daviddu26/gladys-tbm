// -----------------------------------------------------------------------------
// HTTP access to the TBM open data.
//
// Every request goes through `fetchJson`: a timeout (an API that hangs must
// not hold a poll, a widget or a scene action past what Gladys waits for), and
// a User-Agent naming the integration, so that the data producer can tell who
// is reading and how to reach the maintainer.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

export const USER_AGENT = `gladys-tbm/${pkg.version} (+https://github.com/daviddu26/gladys-tbm)`;

// Gladys waits 15 s for a widget and a scene action: a request must give up
// well before, so the caller still has time to say why.
const TIMEOUT_MS = 10_000;

/**
 * Error raised when the TBM API does not answer what was expected. It carries
 * the bilingual explanation shown to the user (action messages, widget cards,
 * connection status).
 */
export class TbmApiError extends Error {
  /**
   * @param {string} message technical message, for the logs
   * @param {{ status?: number, userMessage?: { en: string, fr: string } }} [details]
   */
  constructor(message, { status, userMessage } = {}) {
    super(message);
    this.name = 'TbmApiError';
    this.status = status;
    this.userMessage = userMessage ?? {
      en: 'The TBM real-time service does not answer right now: try again in a few minutes.',
      fr: 'Le service temps réel TBM ne répond pas pour l’instant : réessayez dans quelques minutes.',
    };
  }
}

/**
 * GET a JSON document.
 * @param {string} url
 * @returns {Promise<unknown>}
 * @throws {TbmApiError}
 */
export async function fetchJson(url) {
  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new TbmApiError(`TBM API unreachable: ${err.message}`);
  }
  if (!response.ok) {
    throw new TbmApiError(`TBM API answered HTTP ${response.status}`, { status: response.status });
  }
  try {
    return await response.json();
  } catch (err) {
    throw new TbmApiError(`TBM API answered something that is not JSON: ${err.message}`);
  }
}
