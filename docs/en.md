# TBM

This integration brings the **real-time departures** of the trams, buses and boats of the **TBM**
network (Bordeaux Métropole) into Gladys, **direction by direction**: for each line followed at a
station, you know in how many minutes the next vehicle of each direction leaves, and where it
goes.

It also plans your **journeys from the house** to the addresses you choose (work, school, station…):
when to leave, which lines, when you arrive — in real time, with the night lines and the
disruptions.

No account, no key: the TBM real time is open data, and the journeys are planned by
[Transitous](https://transitous.org), a free community service.

> Community integration, not affiliated with TBM, Keolis Bordeaux Métropole Mobilités nor Bordeaux
> Métropole.

> **Beta version.** Departures and journeys work, but the integration is young: report any issue
> or idea on [GitHub](https://github.com/daviddu26/gladys-tbm/issues), with a screenshot if you
> can.

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

| Feature                                   | Value                                                           |
| ----------------------------------------- | --------------------------------------------------------------- |
| Direction 1 → … · **next departure**      | minutes before the next departure (999: none)                   |
| Direction 1 → … · **destination**         | where that vehicle goes, e.g. "La Gardette"                     |
| Direction 1 → … · **following departure** | minutes before the one after                                    |
| Direction 1 → … · **next departures**     | "La Gardette 3 min · Cenon Gare 11 min (incl. 2 minutes delay)" |

The name of each feature says where the direction goes. The **destination** is the vehicle's own:
on a branching line (tram A after Buttinière), direction 2 leaves for La Gardette one time and for
Cenon Gare the next.

In the texts: **~11 min** is a timetable time (the vehicle is not tracked yet); **(incl. 2 minutes delay)**
a delay already counted in the minutes shown ("11 min (incl. 2 minutes delay)": it leaves in 11 minutes
instead of 9, nothing to add); **(last)** the last departure of the direction before a break of more than two hours, that
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

## Journeys from the house

In the **Configuration** page, section **Journeys from the house**, type up to 5 destinations in
**Journeys**, separated by semicolons, each as "Name: address":
`Work: 1 place Pey Berland, Bordeaux; Station: Gare Saint-Jean`. The name is optional. Add the town
when an address is ambiguous: one found more than 60 km from the house is ignored. Save, then add
the "TBM – Journey → Work" devices from the **Discover** tab.

Journeys start from the address of the house and count the walk to the first stop and from the
last. [Transitous](https://transitous.org) plans them with the TBM real time: a cancelled trip, a
delay, a moved stop, or the end of the tram service (the night buses take over) change the journey.

Features: **leave in** (minutes before leaving the house, 999: none), **duration**, **arrival**
("18:47"), **route** ("Tram A 18:12, change at Porte de Bourgogne: Tram F 18:19"), **next departures** ("18:05 → 18:47 · 18:15 →
18:55"), **status** ("Normal", "4 min late", "Disrupted: …", "Timetable"; or why the journey cannot
be planned, and what to do).

Transitous is a volunteer service asking for a light use. The integration therefore makes a **full
calculation** of the journeys only at first, then each time the first journey proposed has left.
In between, it **updates the real time** of the journeys already found (delays, cancellations)
every **2 minutes** (**Journeys update**), which costs Transitous almost nothing. "Leave in" counts
down every minute.

## Settings

| Setting                   | Role                                                             | Default |
| ------------------------- | ---------------------------------------------------------------- | ------- |
| Stations near my home     | how many close stations are proposed (0: none)                   | 3       |
| Search radius (m)         | the farthest a proposed station may be from the house            | 600     |
| Include the school buses  | also propose the SCODI school lines                              | no      |
| Stations                  | stations typed by hand                                           | empty   |
| Refresh interval (s)      | how often the departures are read                                | 60      |
| Departures in the summary | departures per direction in the "next departures" text           | 3       |
| Journeys                  | destinations of the journeys from the house                      | empty   |
| Journeys update (s)       | how often the real time of the journeys is updated, 120 at least | 120     |
| Language of the values    | language of the feature names and texts                          | French  |

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

The **TBM journey** widget shows a journey: a tile with **in how many minutes to leave**, the lines
and the arrival ("Lianes 4 › TER → 22:00"), the detail with the time of each line above it ("Lianes 4 21:45, change at Gare Saint-Jean: TER ~21:53", and what disrupts the journey, if anything), and the **next options** below, never repeating the tile's. Journeys are **ranked by arrival**: the tile shows the one getting you there first, even if it leaves later than another; a change that needs a walk to another stop says so. A **"~"** marks a timetable time: that vehicle is not tracked in real
time (often a TER, whose real time Transitous lacks). Settings: the **journey** and the **journeys
shown** ("Best only" to 5, the best included; empty: 5).

## Scenes

- Trigger **TBM departure approaching**: a vehicle of a followed line gets under the chosen number
  of minutes (1, 2, 3, 5, 10 or 15), counted on its real-time departure. Filters: the line, the
  direction, the minutes. Once per vehicle and per mark. Variables include a ready-made sentence:
  "Hôtel de Ville: Tram A to La Gardette leaves in 5 min (17:58, incl. 2 minutes delay)."
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

Journeys: [Transitous](https://transitous.org/sources/) (free community service, OpenStreetMap
data and the networks' timetables). The integration names itself to it, keeps the addresses found
in the container, and plans a journey again only at the configured interval.
