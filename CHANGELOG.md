# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

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

[Unreleased]: https://github.com/daviddu26/gladys-tbm/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/daviddu26/gladys-tbm/releases/tag/v0.0.1
