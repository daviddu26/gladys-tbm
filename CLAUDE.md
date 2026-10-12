# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/devices.test.js          # one file
node --test --test-name-pattern "plug"    # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## What this integration does

Real-time departures of the TBM network (Bordeaux Métropole: trams, buses,
boats), read from the TBM SIRI-Lite API with its public open-data key. One
read-only device per **line at a station**, with four features per direction
(next departure, destination, following departure, summary). The stations near
the house are proposed in the Discover tab (`location: true`, `getHouses()`).

Journeys from the house (Transitous): one read-only device per destination of
the `trips` field ("Travail : 1 place Pey Berland"), with the minutes before
leaving, duration, arrival, route, next options and status, and a widget.

## Architecture

```
index.js                          SDK wiring only: handlers registered before connect()
src/api/http.js                   fetch with timeout and User-Agent, TbmApiError
src/api/siri.js                   SIRI-Lite URLs, unwrapping of { value } / [{ value, lang }]
src/api/directory.js              stations (stop areas) and lines, cached a day in /data
src/api/departures.js             stop-monitoring of a station, shared between its devices
src/devices/index.js              registry: configured + suggested + created devices, poller, actions
src/devices/stationLine.js        the device type: a line at a station, both directions
src/devices/suggestions.js        the stations near the house, and the house location
src/devices/trip.js               the device type: a journey from the house (Transitous)
src/api/transitous.js             Transitous: geocode (cached in /data), plan, TransitousError
src/triggers.js                   scene trigger "departure_approaching"
src/scenes.js                     scene action "get_next_departures"
src/widgets.js                    dashboard widgets "departures" and "journey"
src/config.js                     DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
gladys-assistant-integration.json manifest: name, config_schema, actions, image...
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test, against the SDK's fake Gladys (integration-sdk/testing)
test/helpers/fixtures.js          TBM answers shaped like the real ones (2026-10)
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## What is known of the TBM data

- Stop-monitoring answers nothing for a quay (`BP:3718`), everything for a stop
  area (`BP:THDVA`): every line, both directions, about 90 minutes ahead by
  default. `PreviewInterval` is honoured (checked 2026-10-12: PT1H → 1 h,
  PT6H → 6 h, PT12H reaches the next morning): the integration asks `PT4H`,
  which is what shows the last departure of the evening (a departure followed
  by nothing of its line and direction for 2 h, `SERVICE_BREAK_MS`).
- Tram and bus stop areas are distinct (T… / B…), even with the same name.
- A visit: `MonitoredVehicleJourney.{LineRef, DirectionRef ("0"/"1"),
DirectionName[], DestinationName[], FramedVehicleJourneyRef.DatedVehicleJourneyRef,
MonitoredCall.{AimedDepartureTime, ExpectedDepartureTime, ...}}`. No expected
  time = not tracked yet (timetable). No departure time = ends its trip here.
  No cancellation, vehicle-at-stop nor PublishedLineName field.
- lines-discovery has no colour; `LineCode` is the public code ("A", "5"),
  `LineName` the full name ("Tram A", "Lianes 5", "TBNight N1"). Line ids keep
  their leading zeros (`01` is Lianes 1).
- Device params `station`, `line`, `directions` rebuild a created device: never
  rename them. The platform id is `<station>-<line>`.
- Never commit a personal stop: use network landmarks (Hôtel de Ville THDVA,
  Palais de Justice TPJUST, Quinconces BQUIOR) in examples and tests.

## What is known of Transitous

- MOTIS 2 API at `https://api.transitous.org/api` (`/v1/geocode`, `/v6/plan`),
  OpenAPI v2.10.2. Its TBM feed is the same open data (GTFS, GTFS-RT
  TripUpdates, SIRI-Lite): delays, cancellations and the night lines come with
  the plan. Policy: open source, non-commercial, User-Agent with a contact,
  light use — contact the maintainers (Matrix) before the integration gets many
  users. Hence the places geocoded once and kept in `/data/places.json`.
- **Plan as little as possible** (asked by the Transitous team, GitHub issue,
  2026-10-12): `/v6/plan` recomputes everything on rare compute resources.
  A new plan only when there is none, the address changed, or the departure
  of the earliest journey of the last plan has come (`needsNewPlan`); in
  between, every `trips_poll_frequency` (120 s), each journey still to come is
  refreshed with `/v6/refresh-itinerary?itineraryId=` (almost free). A journey
  it cannot rebuild (HTTP 400) is dropped; none left plans again. They also
  asked for an explicit LICENSE file (Apache-2.0, at the root).
- api.transitous.org is out of reach of the development sandbox: the
  fixtures (`test/helpers/transitous.js`) follow the OpenAPI. Seen live on
  2026-10-12 (user's Gladys): the TBM route short names resolve through the
  directory ("Lianes 4", "Locale 80", "Lianes 9"); a TER comes with no real
  time and a train number as its name ("TER 866266"), hence "TER" alone.
- Device params `trip_name`, `trip_address` rebuild a created journey; its
  platform id is the slug of the name (`tripSlug`): renaming a journey makes a
  new device.

## Rules

- **External ids are forever.** Build them with
  `gladys.externalIds(type, platformId)`, `platformId` being the unique id the
  platform gives the device (serial, cloud id, MAC), never a label. Gladys keys
  devices, their history, scenes and dashboards on them: changing one creates a
  new device and orphans the old one. The same goes for every key users store:
  manifest `config_schema`, `actions`, widget and scene keys, feature keys.
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume. Never log tokens, passwords or API keys.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand — except on the README's hand-pushed tag path, which bumps all three
  together before tagging. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section, and it
  becomes the notes of the GitHub Release.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language. A field the
  older cores do not know needs a higher `gladys_version` minimum
  (`categories`: 4.86.0; `widgets`, `scene_triggers`, `scene_actions`,
  `type: "provider"`: 5.1.0). `test/manifest.test.js` ties the manifest to the
  code (defaults, action, scene and widget handlers): change both sides
  together.
- **User-facing text** is bilingual (English and French): action messages,
  manifest texts, and `docs/en.md` / `docs/fr.md`, kept in sync.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.
