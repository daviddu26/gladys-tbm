// -----------------------------------------------------------------------------
// The TBM SIRI-Lite API: addresses and the shape of its answers.
//
// TBM (Bordeaux Métropole) publishes its real time in SIRI-Lite, JSON flavour,
// through the Mecatran/KB2M platform. The access key is public: it is printed
// in the documentation of the open data set and shared by every reader, so it
// is not a secret and the user has nothing to type.
//
// Data set: https://transport.data.gouv.fr/datasets/offres-de-services-bus-tram-et-scolaire-au-format-gtfs-netex-gtfs-rt-siri-lite
// Licence: Licence Ouverte / Open Licence (Etalab 2.0).
//
// The SIRI identifiers this module meets:
//   - a quay (one side of the street, one platform): bordeaux:StopPoint:BP:3718:LOC
//   - a stop area (both sides, the place people name): bordeaux:StopPoint:BP:THDVA:LOC
//     Tram stop areas start with T, bus ones with B: the tram and the bus
//     stopping at "Hôtel de Ville" are two areas.
//   - a line: bordeaux:Line:59:LOC (Tram A; the public code "A" is elsewhere)
//
// Most SIRI values are wrapped: `{ "value": "..." }` for a reference, an array
// of `{ "value": "...", "lang": "fr" }` for a text. `text` and `ref` unwrap
// both shapes, and accept a plain value too, so a change of style on the
// producer side degrades nothing.
// -----------------------------------------------------------------------------

export const SIRI_BASE_URL = 'https://bdx.mecatran.com/utw/ws/siri/2.0/bordeaux';
export const ACCOUNT_KEY = 'opendata-bordeaux-metropole-flux-gtfs-rt';

/**
 * The address of a SIRI-Lite method.
 * @param {string} method e.g. 'stop-monitoring'
 * @param {Record<string, string>} [params]
 */
export function siriUrl(method, params = {}) {
  const query = new URLSearchParams({ AccountKey: ACCOUNT_KEY, ...params });
  return `${SIRI_BASE_URL}/${method}.json?${query}`;
}

/**
 * A SIRI value as a plain string: `{ value }`, `[{ value, lang }]`, or a
 * string already. Several texts are joined (a destination with two names).
 * @param {unknown} node
 * @returns {string}
 */
export function text(node) {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node).trim();
  if (Array.isArray(node)) {
    return node
      .map((item) => text(item))
      .filter(Boolean)
      .join(' / ');
  }
  if (typeof node === 'object' && 'value' in node) return text(node.value);
  return '';
}

/** Same as `text`, for a reference: the name says what the caller expects. */
export const ref = text;

/**
 * The short code of a stop area or quay reference:
 * bordeaux:StopPoint:BP:THDVA:LOC → THDVA.
 * @param {string} reference
 * @returns {string}
 */
export function stopCode(reference) {
  const match = /StopPoint:BP:([^:]+):/.exec(reference ?? '');
  return match ? match[1] : '';
}

/** The reference of a stop area from its code: THDVA → bordeaux:StopPoint:BP:THDVA:LOC. */
export function stopAreaRef(code) {
  return `bordeaux:StopPoint:BP:${code}:LOC`;
}

/**
 * The id of a line reference: bordeaux:Line:59:LOC → 59. Kept as a string:
 * the ids carry leading zeros (01 is Lianes 1, not 1).
 * @param {string} reference
 * @returns {string}
 */
export function lineId(reference) {
  const match = /Line:([^:]+):/.exec(reference ?? '');
  return match ? match[1] : '';
}
