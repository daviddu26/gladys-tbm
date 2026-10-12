// -----------------------------------------------------------------------------
// Scene action "read the next departures" (manifest `scene_actions`).
//
// A scene reaches the action, the integration reads the line at its station
// (or reuses a read a few seconds old) and returns the next departure as
// outputs the following actions use: "{{tbm.minutes}}", a ready-made
// sentence for a notification or a voice announcement.
//
// The rules of the core: fields arrive resolved, outputs are scalars, throwing
// fails this action only (the scene goes on), and an action never fires a
// scene event (a scene bound to it would loop).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { formatClock } from './api/departures.js';
import { findSelectedBlueprint } from './devices/index.js';
import { directionRank } from './devices/stationLine.js';
import { departureSentence } from './triggers.js';

const logger = createLogger({ name: 'scenes' });

export const SCENE_ACTIONS = {
  async get_next_departures(gladys, { fields, config }) {
    const blueprint = findSelectedBlueprint(gladys, fields.device, config);
    const direction = fields.direction === '0' || fields.direction === '1' ? fields.direction : '';
    const departures = (await blueprint.read()).filter(
      (departure) => !direction || departure.direction === direction,
    );
    const [next, following] = departures;
    const info = blueprint.describe();
    logger.info(`Scene action get_next_departures <- ${blueprint.key}`);
    if (!next) {
      return {
        found: false,
        minutes: -1,
        following_minutes: -1,
        line: info.lineCode,
        destination: '',
        direction_rank: direction ? directionRank(direction) : 0,
        time: '',
        delay: 0,
        realtime: false,
        summary:
          config.language === 'en'
            ? `${info.stationName}: no ${info.lineName} departure in the next hour.`
            : `${info.stationName} : aucun passage du ${info.lineName} dans l’heure.`,
      };
    }
    return {
      found: true,
      minutes: next.minutes,
      following_minutes: following ? following.minutes : -1,
      line: info.lineCode,
      destination: next.destination,
      direction_rank: directionRank(next.direction),
      time: formatClock(next.time),
      delay: next.delayMinutes ?? 0,
      realtime: next.realtime,
      summary: departureSentence(info, next, config.language),
    };
  },
};
