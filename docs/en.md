# TBM

This integration brings the **real-time departures** of the trams, buses and boats of the **TBM**
network (Bordeaux Métropole) into Gladys, **direction by direction**: for each line followed at a
station, you know in how many minutes the next vehicle of each direction leaves, and where it
goes.

No account, no key: the TBM real time is open data.

> Community integration, not affiliated with TBM, Keolis Bordeaux Métropole Mobilités nor Bordeaux
> Métropole.

## Getting started

1. **Give your house an address** in Gladys: **Settings → Houses**. The integration uses it to
   find the stations nearby.
2. Open the **Configuration** page of the integration and press **Save** (the defaults suit).
3. Open the **Discover** tab: the lines of the 3 closest stations (within 600 m) are proposed
   there, e.g. "TBM – Hôtel de Ville – Tram A". Press **Add** on the ones you want.

The next departures arrive within a minute.

With several houses in Gladys, the integration looks around the **first house that has an
address**, in alphabetical order.

## What you get

One device per **line at a station**. For each direction of the line:

| Feature                                   | Value                                                |
| ----------------------------------------- | ---------------------------------------------------- |
| Direction 1 → … · **next departure**      | minutes before the next departure (999: none)        |
| Direction 1 → … · **destination**         | where that vehicle goes, e.g. "La Gardette"          |
| Direction 1 → … · **following departure** | minutes before the one after                         |
| Direction 1 → … · **next departures**     | "La Gardette 3 min · Cenon Gare 11 min (2 min late)" |

The name of each feature says where the direction goes. The **destination** is the vehicle's own:
on a branching line (tram A after Buttinière), direction 2 leaves for La Gardette one time and for
Cenon Gare the next.

In the texts: **~11 min** is a timetable time (the vehicle is not tracked yet); **(2 min late)** a
delay, already counted in the minutes shown ("11 min (2 min late)": it leaves in 11 minutes instead
of 9); **(last)** the last departure of the direction before a break of more than two hours, that
is usually the last of the evening, flagged up to two hours ahead; **now** less than a minute.
Values keep no history.

Set **Language of the values** to English for English feature names and texts.

## Following another station

1. At the bottom of the **Configuration** page, press **Find a station** and type part of the
   name ("Quinconces"). The answer gives the code of each station and its lines. The tram and the
   bus stopping at the same place are two stations (tram codes start with T, bus codes with B).
2. Paste the code in **Stations**. To keep only some lines, add `@` and their numbers separated by
   `|`: `THDVA` (every line of Hôtel de Ville), `THDVA@A` (tram A only), `BQUIOR@2|N6`. Several
   stations: separate them with commas.
3. Save, then add the devices from the **Discover** tab.

## Settings

| Setting                   | Role                                                   | Default |
| ------------------------- | ------------------------------------------------------ | ------- |
| Stations near my home     | how many close stations are proposed (0: none)         | 3       |
| Search radius (m)         | the farthest a proposed station may be from the house  | 600     |
| Include the school buses  | also propose the SCODI school lines                    | no      |
| Stations                  | stations typed by hand                                 | empty   |
| Refresh interval (s)      | how often the departures are read                      | 60      |
| Departures in the summary | departures per direction in the "next departures" text | 3       |
| Language of the values    | language of the feature names and texts                | French  |

Replacement buses during works ("Navette Tram", "Bus Relais") are not proposed automatically: add
them by number in **Stations** if needed.

## Dashboard

The **TBM departures** widget shows a line at a station like a stop sign: one tile per direction
with the next departure, then the **following** departures (the next one, already in its tile, is
not repeated) — green when tracked in real time, grey ("~") for a timetable time, orange from 5
minutes late or for the **last departure** of the evening, also announced under the title ("Last
at 00:24 → Le Haillan Rostand").

In its settings, choose the **line at a station**, the **direction** ("Both directions",
"Direction 1" or "Direction 2", numbered as in the feature names of the device; with one direction,
where it goes is shown under the title) and the **departures shown** per direction, the tile
included: "Next only" keeps the tiles alone, "3 departures" is the tile and the 2 following. Left
empty: both directions, 5 departures. Add two widgets for the same line to follow each direction on
its own.

## Scenes

- Trigger **TBM departure approaching**: a vehicle of a followed line gets under the chosen number
  of minutes (1, 2, 3, 5, 10 or 15), counted on its real-time departure. Filters: the line, the
  direction, the minutes. Once per vehicle and per mark. Variables include a ready-made sentence:
  "Hôtel de Ville: Tram A to La Gardette leaves in 5 min (17:58, 2 min late)."
- Action **Read the next TBM departure**: the next departure of a line (one direction or both),
  as outputs for the following actions of the scene.

## Buttons of the configuration page

- **Find a station** — finds the code of a station by its name.
- **Test the connection** — reads TBM now and shows what it found.

## Data

Real time and network directory: TBM / Bordeaux Métropole,
[Réseau urbain et scolaire TBM](https://transport.data.gouv.fr/datasets/offres-de-services-bus-tram-et-scolaire-au-format-gtfs-netex-gtfs-rt-siri-lite),
under the [Licence Ouverte](https://www.etalab.gouv.fr/licence-ouverte-open-licence/). The
directory is read once a day; the departures once a minute per station, however many of its lines
are followed.
