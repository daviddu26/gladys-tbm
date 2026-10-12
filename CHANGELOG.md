# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.0.5] - 2026-10-12

### Added

- Widget: a "Both directions" choice in the "Direction" setting (leaving it
  empty still means both).

### Changed

- A delay reads "11 min (dont 3 minutes de retard)": the words say that the
  minutes already count it.

### Fixed

- Widget: the list no longer repeats the next departure already shown in the
  tile; "Departures shown" now counts per direction, the tile included.

## [0.0.4] - 2026-10-12

## [0.0.3] - 2026-10-12

### Added

- The last departure of a direction before a break in service (usually the
  last of the evening) is flagged: "(dernier)" in the texts, an orange row and
  tile in the widget, and "Dernier à 00:24 → …" under its title. Stations are
  now read four hours ahead to see it coming.
- Dashboard widget: a "Departures shown" setting, from the next one only to 5.

### Changed

- The integration is named "TBM", and the cover image carries a TBM banner.
- A delay reads "7 min (5 min de retard)" instead of "7 min (+5)": the minutes
  already count the delay, the bare "+5" looked like another departure.

### Fixed

- Widget: the caption under the title no longer goes past the 80 characters
  Gladys shows; the name of a long direction is shortened instead.

## [0.0.2] - 2026-10-12

### Added

- Dashboard widget "TBM departures": a "Direction" setting shows a single
  direction (its tile, its departures and where it goes); empty keeps both.

### Changed

- New cover image: a tram crossing the stone bridge by day, in front of the
  Bordeaux skyline.

## [0.0.1] - 2026-10-12

### Added

- Real-time departures of the TBM network (Bordeaux): one device per line
  followed at a station, with, for each direction, the minutes before the next
  departure, its destination, the following departure and a summary text.
- The stations near the house (address of the house in Gladys) are proposed in
  the Discover tab, every line of each station; other stations can be typed by
  code, with a line filter (`THDVA@A`).
- "Find a station" and "Test the connection" buttons.
- Dashboard widget "TBM departures": a tile per direction and the next
  departures of both, real time in green, timetable in grey, late in orange.
- Scene trigger "TBM departure approaching" (1 to 15 minutes, per direction),
  with a ready-made sentence; scene action "Read the next TBM departure".
- The network directory is read once a day and kept in `/data`: a restart or an
  API outage keeps the stations known.

[Unreleased]: https://github.com/daviddu26/gladys-tbm/compare/v0.0.5...HEAD
[0.0.5]: https://github.com/daviddu26/gladys-tbm/compare/v0.0.4...v0.0.5
[0.0.4]: https://github.com/daviddu26/gladys-tbm/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/daviddu26/gladys-tbm/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/daviddu26/gladys-tbm/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/daviddu26/gladys-tbm/releases/tag/v0.0.1
