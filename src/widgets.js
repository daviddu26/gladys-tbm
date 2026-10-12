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

/**
 * The card of one line at one station.
 * @param {{ stationName: string, lineName: string, lineCode: string, directions: string[] }} info
 * @param {object[]} departures upcoming, both directions, soonest first
 * @param {string} language
 */
export function departuresContent(info, departures, language = 'fr') {
  const components = [
    {
      type: 'text',
      variant: WIDGET_TEXT_VARIANTS.HEADING,
      text: truncate(`${info.stationName} · ${info.lineName}`, 40),
    },
  ];

  for (const direction of info.directions) {
    const next = departures.find((departure) => departure.direction === direction);
    const rank = directionRank(direction);
    components.push(
      next
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
          },
    );
  }

  const board = departures.slice(0, BOARD_ROWS);
  if (board.length === 0) {
    components.push({
      type: 'text',
      variant: WIDGET_TEXT_VARIANTS.CAPTION,
      text: { en: 'No departure in the next hour.', fr: 'Aucun passage dans l’heure.' },
    });
    return { ttl_seconds: TTL_SECONDS, components };
  }

  components.push({
    type: 'status',
    items: board.map((departure) => ({
      label: truncate(`${info.lineCode} → ${departure.destination}`, 40),
      value: truncate(formatWait(departure, language), 40),
      color: rowColor(departure),
    })),
  });
  if (board.some((departure) => !departure.realtime)) {
    components.push({
      type: 'text',
      variant: WIDGET_TEXT_VARIANTS.CAPTION,
      text: { en: '~ timetable, not tracked yet.', fr: '~ horaire théorique, pas encore suivi.' },
    });
  }
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
        return departuresContent(blueprint.describe(), departures, language === 'en' ? 'en' : 'fr');
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
