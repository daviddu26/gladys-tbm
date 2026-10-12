// -----------------------------------------------------------------------------
// The wiring of the integration: every SDK handler, and what happens on each
// (re)connection. Separate from index.js so that the tests can run it against
// the fake Gladys of the SDK, lifecycle included.
//
// On every (re)connection: read the configuration, the network directory and
// the house location, then publish the devices and the connection status.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { loadDirectory } from './api/directory.js';
import {
  ACTIONS,
  buildDiscoveredDevices,
  configuredEntries,
  createPoller,
} from './devices/index.js';
import { getSuggestions, refreshSuggestions } from './devices/suggestions.js';
import { SCENE_ACTIONS } from './scenes.js';
import { WIDGETS, refreshWidgets } from './widgets.js';

const logger = createLogger({ name: 'app' });

// The directory (stations, lines) is read once a day at most: checking every
// six hours picks a new version up within the day.
const DIRECTORY_CHECK_MS = 6 * 3600 * 1000;

/**
 * The connection status of the Configuration screen: what works, and what the
 * user has to do next when something does not.
 * @param {boolean} directoryAvailable
 * @param {ReturnType<typeof normalizeConfig>} config
 * @returns {[boolean, { en: string, fr: string }?]}
 */
export function connectionStatus(directoryAvailable, config) {
  if (!directoryAvailable) {
    return [
      false,
      {
        en: 'The TBM service does not answer: the integration tries again by itself.',
        fr: 'Le service TBM ne répond pas : l’intégration réessaie d’elle-même.',
      },
    ];
  }
  const { unknown } = configuredEntries(config);
  if (unknown.length > 0) {
    return [
      true,
      {
        en: `Not found in "Stations": ${unknown.join(', ')}. Use "Find a station" to get the codes.`,
        fr: `Introuvable dans « Stations » : ${unknown.join(', ')}. Utilisez « Chercher une station » pour avoir les codes.`,
      },
    ];
  }
  if (config.journeys.invalid.length > 0) {
    return [
      true,
      {
        en: `Not understood in "Journeys": ${config.journeys.invalid.join(' ; ')}. One journey per line, "Name: address", 5 at most.`,
        fr: `Non compris dans « Trajets » : ${config.journeys.invalid.join(' ; ')}. Un trajet par ligne, « Nom : adresse », 5 au plus.`,
      },
    ];
  }
  const { status } = getSuggestions();
  if (status === 'no_location') {
    return [
      true,
      {
        en: 'Give your house an address in Gladys (Settings → Houses) to get the stations near it.',
        fr: 'Donnez une adresse à votre maison dans Gladys (Paramètres → Maisons) pour avoir les stations proches.',
      },
    ];
  }
  if (status === 'no_permission') {
    return [
      true,
      {
        en: 'Gladys does not share the house location: only the stations typed in "Stations" are followed.',
        fr: 'Gladys ne partage pas la position de la maison : seules les stations saisies dans « Stations » sont suivies.',
      },
    ];
  }
  return [true];
}

/**
 * Register every handler on a Gladys client, before connect().
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @returns {{ stop: () => void, config: () => ReturnType<typeof normalizeConfig> }}
 */
export function registerHandlers(gladys) {
  let config = normalizeConfig();
  let directoryAvailable = false;
  let directoryTimer = null;

  /** Read the directory; never throws (the status says when it failed). */
  async function refreshDirectory(options) {
    try {
      await loadDirectory(options);
      directoryAvailable = true;
    } catch (err) {
      logger.error(`The TBM directory could not be read: ${err.message}`);
      directoryAvailable = false;
    }
  }

  /** Recompute the suggestions, publish the devices and the status. */
  async function publishEverything() {
    await refreshSuggestions(gladys, config);
    await gladys.publishDiscoveredDevices(buildDiscoveredDevices(gladys, config));
    await gladys.setConnectionStatus(...connectionStatus(directoryAvailable, config));
    refreshWidgets(gladys);
  }

  function stop() {
    clearInterval(directoryTimer);
    directoryTimer = null;
  }

  // Discovery: Gladys asks for the list of devices.
  gladys.onScanRequest(async () => {
    await refreshDirectory();
    await publishEverything();
  });

  // Polling: Gladys asks to refresh a device, once a minute; the poller keeps
  // the interval of the configuration.
  const pollDevice = createPoller();
  gladys.onPoll(async (device) => {
    await pollDevice(gladys, device, config);
  });

  // A device just created has no value yet: read it now rather than at the
  // next poll tick. The SDK already forgot the states published for it.
  gladys.onDeviceCreated(async (device) => {
    await pollDevice(gladys, device, config, { force: true });
  });
  gladys.onDeviceUpdated(async (device) => {
    await pollDevice(gladys, device, config, { force: true });
  });

  // Buttons of the Configuration screen.
  for (const [key, handler] of Object.entries(ACTIONS)) {
    gladys.onAction(key, (fields) => handler(gladys, { fields, config }));
  }

  // Scene actions.
  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(key, (fields) => handler(gladys, { fields, config }));
  }

  // Dashboard widgets.
  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(key, (request) => widget.get(gladys, { ...request, config }));
  }

  // Configuration updated by the user.
  gladys.onConfigUpdated(async (newConfig) => {
    logger.info('onConfigUpdated -> new configuration received');
    config = normalizeConfig(newConfig);
    await publishEverything();
  });

  gladys.on('connected', async () => {
    try {
      config = normalizeConfig(await gladys.getConfig());
      await refreshDirectory();
      await publishEverything();

      clearInterval(directoryTimer);
      directoryTimer = setInterval(() => {
        refreshDirectory()
          .then(publishEverything)
          .catch((err) => logger.error('Periodic directory refresh failed', err));
      }, DIRECTORY_CHECK_MS);
      directoryTimer.unref?.();
    } catch (err) {
      logger.error('Post-connection initialization failed', err);
      await gladys
        .setConnectionStatus(false, {
          en: 'Initialization failed, check the integration logs.',
          fr: 'L’initialisation a échoué, consultez les logs de l’intégration.',
        })
        .catch(() => {});
    }
  });

  gladys.on('disconnected', stop);

  return { stop, config: () => config };
}
