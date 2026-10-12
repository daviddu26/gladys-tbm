# Gladys TBM

> **Beta.** Feedback welcome in the [issues](https://github.com/daviddu26/gladys-tbm/issues).

External integration for [Gladys Assistant](https://gladysassistant.com) that brings the TBM
network of Bordeaux Métropole (trams, buses, boats) into your smart home:

- **next departures in real time, direction by direction**, for every line followed at a
  station: minutes to wait, destination of the vehicle, the following one, delay;
- **the stations near your home proposed by themselves** in the Discover tab, from the address of
  the house in Gladys;
- **journeys from the house** to the addresses you choose: when to leave, which lines, when you
  arrive, in real time with the night lines and the disruptions (planned by
  [Transitous](https://transitous.org));
- **dashboard widgets** (departure board, journey), a **scene trigger** ("departure approaching")
  and a **scene action** ("read the next departure").

**No account, no key:** the TBM real time is open data.

Unofficial: not affiliated with TBM, Keolis Bordeaux Métropole Mobilités nor Bordeaux Métropole.

User documentation: [français](docs/fr.md) · [English](docs/en.md).

## What you get in Gladys

| Kind             | Content                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------- |
| Devices          | one per line at a station; per direction: next departure, destination, following, summary |
| Devices          | one per journey from the house: leave in, duration, arrival, route, options, status       |
| Dashboard widget | departures board of a line at a station, one direction or both                            |
| Dashboard widget | journey: when to leave, the lines, the next options                                       |
| Scene trigger    | departure approaching (1–15 min), per direction                                           |
| Scene action     | read the next departure                                                                   |
| Buttons          | find a station by name, test the connection                                               |

Requires Gladys **5.1.0** or later.

## How it works

The data comes from the TBM SIRI-Lite API (Mecatran/KB2M platform), with the public access key of
the open data set:

- **stoppoints-discovery** and **lines-discovery** give the directory: ~5,000 quays grouped into
  stations (stop areas, the place people name), ~200 lines with their public code ("A", "5") and
  the names of their two directions. Read once a day, cached in `/data`.
- **stop-monitoring**, asked for a station, gives every line and both directions for the next
  hour and a half: direction, destination of each vehicle, aimed time, and expected time when the
  vehicle is tracked. One request per station and per minute, shared by all its devices.

The feed has no cancellation flag: a vehicle not tracked yet shows its timetable time, marked "~".

**Journeys** come from [Transitous](https://transitous.org/api/) (MOTIS 2): `/api/v1/geocode`
finds the addresses typed by the user near the house (kept in `/data`), `/api/v6/plan` plans the
journeys from the house, with the TBM real time Transitous loads. As the Transitous team asked, a
journey is planned again only when the first journey of the last plan has left; in between, the
journeys found are kept up to date with `/api/v6/refresh-itinerary`, almost free for Transitous
(every 2 minutes by default).

## Development

```bash
npm install
npm test               # node --test, no network access
npm run lint           # ESLint
npm run format:check   # Prettier, as the CI runs it
npx github:GladysAssistant/integration-store .   # store admission checks
```

The project follows the official
[integration template](https://github.com/GladysAssistant/integration-template-js): Node 22+, ES
modules, the Gladys SDK as the only runtime dependency, a multi-arch Docker image published to
GHCR by the Release workflow. See [CLAUDE.md](CLAUDE.md) for the architecture and the
conventions.

### Publishing a version

1. In GitHub: **Actions → Release → Run workflow**, choose **minor** for the first release
   (0.0.0 → 0.1.0). It bumps the version, rolls the changelog, tags, builds the image
   (`linux/amd64`, `linux/arm64`) and creates the GitHub Release.
2. The first time only: make the GHCR package **public** (Packages → gladys-tbm → Package
   settings → Change visibility). Gladys refuses an image it cannot pull.
3. Add the topic `gladys-assistant-integration` to the repository: the store picks the
   integration up within the hour.

## Credits

The design borrows ideas from other Gladys transit integrations:
[gladys-idfm](https://github.com/William-De71/gladys-idfm) (SIRI-Lite stop monitoring by stop
area) and the [gladys-stm](https://github.com/LM1LC3N7/gladys-stm) family (stations near the
house, departures widget, "departure approaching" trigger).

## Data and licences

- Network directory and real time: TBM / Bordeaux Métropole, data set
  [Réseau urbain et scolaire TBM](https://transport.data.gouv.fr/datasets/offres-de-services-bus-tram-et-scolaire-au-format-gtfs-netex-gtfs-rt-siri-lite),
  [Licence Ouverte / Open Licence](https://www.etalab.gouv.fr/licence-ouverte-open-licence/).
- Code: Apache License 2.0.
