// -----------------------------------------------------------------------------
// Dashboard widget "departures board" (manifest `widgets`).
//
// The devices already put every value on the dashboard, one feature per tile,
// and that is exactly what a departure board is bad at. The widget is a card
// the integration composes itself, for one line at one station:
//   - one tile per direction: the minutes before the next departure, and where
//     it goes;
//   - the next departures of both directions, soonest first, green when the
//     vehicle is tracked in real time, grey ("~") for a timetable guess,
//     orange when it runs five minutes late or more.
//
// Nothing here throws at the dashboard: a device removed, or the API down,
// renders as a card saying so — an empty or failed widget tells nothing.
// -----------------------------------------------------------------------------

import {
  createLogger,
  WIDGET_COLORS,
  WIDGET_TEXT_VARIANTS,
} from '@gladysassistant/integration-sdk';
import { DeviceSelectionError, findSelectedBlueprint } from './devices/index.js';
import { directionRank, formatWait } from './devices/stationLine.js';
import { TbmApiError } from './api/http.js';
import { formatClock } from './api/departures.js';

const logger = createLogger({ name: 'widgets' });

/** Widget key, as declared in the manifest. Forever. */
export const DEPARTURES_WIDGET = 'departures';

// Countdowns move every minute; the core re-pulls the card at this pace.
const TTL_SECONDS = 30;
// The core caps a status list at ten rows.
const BOARD_ROWS = 10;

const { NEUTRAL, SUCCESS, WARNING } = WIDGET_COLORS;

/** Cut a text to the budget of its component. */
export function truncate(value, max) {
  const text = String(value ?? '');
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function messageContent(message, ttl = 60) {
  return {
    ttl_seconds: ttl,
    components: [{ type: 'text', variant: WIDGET_TEXT_VARIANTS.BODY, text: message }],
  };
}

// The last departure of the evening is worth a glance before leaving: orange,
// like a vehicle running five minutes late or more.
function rowColor(departure) {
  if (departure.last) return WARNING;
  if (!departure.realtime) return NEUTRAL;
  return (departure.delayMinutes ?? 0) >= 5 ? WARNING : SUCCESS;
}

function tileColor(departure) {
  if (departure.last) return WARNING;
  return departure.realtime ? SUCCESS : NEUTRAL;
}

// The ids of the two directions in the TBM data (DirectionRef).
const DIRECTIONS = ['0', '1'];

/** The direction chosen in the widget settings, or null for both ("both", empty). */
export function selectedDirection(value) {
  const direction = String(value ?? '').trim();
  return DIRECTIONS.includes(direction) ? direction : null;
}

// How many departures the card lists, as chosen in its settings (1 to 5).
export const DEFAULT_COUNT = 5;
const MAX_COUNT = 5;

/** The number of departures chosen in the widget settings, 1 to 5. */
export function selectedCount(value) {
  const count = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(count)) return DEFAULT_COUNT;
  return Math.min(MAX_COUNT, Math.max(1, count));
}

// A caption longer than this is cut by Gladys (widget contract).
const CAPTION_MAX = 80;

/**
 * The one caption a card allows, from notes ranked by importance: as many as
 * fit, the most important first, shown in their own order. A note with a
 * `fit(room)` (where the direction goes, a long name) is shortened to the room
 * left instead of being dropped.
 * @param {{ rank: number, en?: string, fr?: string,
 *   fit?: (room: { en: number, fr: number }) => { en: string, fr: string } | null }[]} notes
 *   in display order
 */
export function captionText(notes) {
  const kept = new Map();
  let en = 0;
  let fr = 0;
  for (const note of [...notes].sort((a, b) => a.rank - b.rank)) {
    const sep = kept.size ? 1 : 0;
    const room = { en: CAPTION_MAX - en - sep, fr: CAPTION_MAX - fr - sep };
    const text = note.fit ? note.fit(room) : { en: note.en, fr: note.fr };
    if (text && text.en.length <= room.en && text.fr.length <= room.fr) {
      kept.set(note, text);
      en += sep + text.en.length;
      fr += sep + text.fr.length;
    }
  }
  const shown = notes.filter((note) => kept.has(note)).map((note) => kept.get(note));
  if (shown.length === 0) return null;
  return {
    en: shown.map((text) => text.en).join(' '),
    fr: shown.map((text) => text.fr).join(' '),
  };
}

/** "Sens 2 → Cenon Gare / La Gardette.", the name cut to the room left. */
function directionNote(rank, name) {
  return {
    rank: 2,
    fit: (room) => {
      const en = `Direction ${rank}`;
      const fr = `Sens ${rank}`;
      if (!name) return { en: `${en}.`, fr: `${fr}.` };
      // " → " and the final dot around the name.
      const cut = (prefix, max) => {
        const left = max - prefix.length - 4;
        return left >= 8 ? `${prefix} → ${truncate(name, left)}.` : `${prefix}.`;
      };
      return { en: cut(en, room.en), fr: cut(fr, room.fr) };
    },
  };
}

/**
 * The card of one line at one station.
 * @param {{ stationName: string, lineName: string, lineCode: string, directions: string[],
 *   directionNames?: Record<string, string> }} info
 * @param {object[]} departures upcoming, both directions, soonest first
 * @param {string} language
 * @param {{ direction?: string | null, count?: number }} [options] one direction
 *   ('0' or '1') or both, and how many departures per direction, the tile
 *   included (1: the tiles only)
 */
export function departuresContent(
  info,
  departures,
  language = 'fr',
  { direction = null, count = DEFAULT_COUNT } = {},
) {
  const components = [
    {
      type: 'text',
      variant: WIDGET_TEXT_VARIANTS.HEADING,
      text: truncate(`${info.stationName} · ${info.lineName}`, 40),
    },
  ];

  // One direction chosen: a stop sign on a platform shows one way only, so the
  // card keeps that direction's tile and departures, and names where it goes.
  const shown = direction ? [direction] : info.directions;
  if (direction) {
    departures = departures.filter((departure) => departure.direction === direction);
  }

  // The widget contract allows two texts per card: the heading and one
  // caption. Everything else worth a line is a note of that caption, ranked:
  // the last departure of the evening first, then where the direction goes,
  // then the explanations of the board.
  const notes = [];
  if (direction) {
    notes.push(directionNote(directionRank(direction), info.directionNames?.[direction] ?? ''));
  }
  for (const id of shown) {
    const last = departures.find((departure) => departure.direction === id && departure.last);
    if (last) {
      const where = truncate(last.destination, 24);
      notes.push({
        rank: 1,
        en: `Last at ${formatClock(last.time)} → ${where}.`,
        fr: `Dernier à ${formatClock(last.time)} → ${where}.`,
      });
    }
  }

  const tiles = shown.map((id) => {
    const next = departures.find((departure) => departure.direction === id);
    const rank = directionRank(id);
    return next
      ? {
          type: 'value',
          value: next.minutes,
          unit: 'min',
          label: truncate(`${rank} → ${next.destination}`, 24),
          icon: 'clock',
          color: tileColor(next),
        }
      : {
          type: 'value',
          value: '—',
          label: { en: `Direction ${rank}`, fr: `Sens ${rank}` },
          icon: 'clock',
          color: NEUTRAL,
        };
  });

  // The count includes the tile: the tile of a direction is its next
  // departure, the list goes on with the following ones only (count - 1 per
  // direction), so no departure is shown twice.
  const inTiles = new Set(
    shown.map((id) => departures.find((departure) => departure.direction === id)),
  );
  const perDirection = new Map();
  const board = departures
    .filter((departure) => !inTiles.has(departure))
    .filter((departure) => {
      const listed = perDirection.get(departure.direction) ?? 0;
      if (listed >= count - 1) return false;
      perDirection.set(departure.direction, listed + 1);
      return true;
    })
    .slice(0, BOARD_ROWS);
  if (departures.length === 0) {
    notes.push({
      rank: 3,
      en: 'No departure in the next hours.',
      fr: 'Aucun passage dans les prochaines heures.',
    });
  } else if ([...inTiles, ...board].some((departure) => departure && !departure.realtime)) {
    notes.push({ rank: 4, en: '~ timetable, not tracked yet.', fr: '~ horaire théorique.' });
  }
  const text = captionText(notes);
  const caption = text ? { type: 'text', variant: WIDGET_TEXT_VARIANTS.CAPTION, text } : null;

  // With one direction, its name belongs right under the heading; with both,
  // the caption only explains the board, so it comes last.
  if (direction && caption) components.push(caption);
  components.push(...tiles);
  if (board.length > 0) {
    components.push({
      type: 'status',
      items: board.map((departure) => ({
        label: truncate(`${info.lineCode} → ${departure.destination}`, 40),
        value: truncate(formatWait(departure, language), 40),
        color: rowColor(departure),
      })),
    });
  }
  if (!direction && caption) components.push(caption);
  return { ttl_seconds: TTL_SECONDS, components };
}

export const WIDGETS = {
  [DEPARTURES_WIDGET]: {
    async get(gladys, { settings, language, config }) {
      let blueprint;
      try {
        blueprint = findSelectedBlueprint(gladys, settings?.device, config);
      } catch (err) {
        if (err instanceof DeviceSelectionError) return messageContent(err.userMessage, 300);
        throw err;
      }
      try {
        const departures = await blueprint.read();
        return departuresContent(
          blueprint.describe(),
          departures,
          language === 'en' ? 'en' : 'fr',
          {
            direction: selectedDirection(settings?.direction),
            count: selectedCount(settings?.count),
          },
        );
      } catch (err) {
        if (err instanceof TbmApiError) {
          logger.warn(`Widget ${DEPARTURES_WIDGET}: ${err.message}`);
          return messageContent(err.userMessage, 60);
        }
        throw err;
      }
    },
  },
};

/**
 * Ask the core to re-pull every widget now (after a reconnection or a
 * configuration change). Fire-and-forget, rate-limited core-side.
 */
export function refreshWidgets(gladys) {
  for (const key of Object.keys(WIDGETS)) {
    gladys.requestWidgetRefresh(key);
  }
}
