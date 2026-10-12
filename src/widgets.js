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

const logger = createLogger({ name: 'widgets' });

/** Widget key, as declared in the manifest. Forever. */
export const DEPARTURES_WIDGET = 'departures';

// Countdowns move every minute; the core re-pulls the card at this pace.
const TTL_SECONDS = 30;
// The core caps a status list at ten rows; a board is read at a glance.
const BOARD_ROWS = 8;

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

function rowColor(departure) {
  if (!departure.realtime) return NEUTRAL;
  return (departure.delayMinutes ?? 0) >= 5 ? WARNING : SUCCESS;
}

// The ids of the two directions in the TBM data (DirectionRef).
const DIRECTIONS = ['0', '1'];

/** The direction chosen in the widget settings, or null for both. */
export function selectedDirection(value) {
  const direction = String(value ?? '').trim();
  return DIRECTIONS.includes(direction) ? direction : null;
}

/**
 * The card of one line at one station.
 * @param {{ stationName: string, lineName: string, lineCode: string, directions: string[],
 *   directionNames?: Record<string, string> }} info
 * @param {object[]} departures upcoming, both directions, soonest first
 * @param {string} language
 * @param {string|null} direction one direction ('0' or '1'), or null for both
 */
export function departuresContent(info, departures, language = 'fr', direction = null) {
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
  // caption. Everything else worth a line (where the chosen direction goes,
  // an empty board, timetable guesses) is gathered into that caption.
  const notes = { en: [], fr: [] };
  if (direction) {
    const rank = directionRank(direction);
    const name = info.directionNames?.[direction];
    notes.en.push(name ? `Direction ${rank} → ${name}.` : `Direction ${rank}.`);
    notes.fr.push(name ? `Sens ${rank} → ${name}.` : `Sens ${rank}.`);
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
          color: next.realtime ? SUCCESS : NEUTRAL,
        }
      : {
          type: 'value',
          value: '—',
          label: { en: `Direction ${rank}`, fr: `Sens ${rank}` },
          icon: 'clock',
          color: NEUTRAL,
        };
  });

  const board = departures.slice(0, BOARD_ROWS);
  if (board.length === 0) {
    notes.en.push('No departure in the next hour.');
    notes.fr.push('Aucun passage dans l’heure.');
  } else if (board.some((departure) => !departure.realtime)) {
    notes.en.push('~ timetable, not tracked yet.');
    notes.fr.push('~ horaire théorique, pas encore suivi.');
  }
  const caption = notes.fr.length
    ? {
        type: 'text',
        variant: WIDGET_TEXT_VARIANTS.CAPTION,
        text: { en: truncate(notes.en.join(' '), 300), fr: truncate(notes.fr.join(' '), 300) },
      }
    : null;

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
          selectedDirection(settings?.direction),
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
