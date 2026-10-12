// -----------------------------------------------------------------------------
// Answers of the TBM SIRI-Lite API, shaped like the real ones.
//
// The shapes (wrapped values, arrays of texts, where the times sit) were taken
// from real answers of 2026-10-12: stop-monitoring of the THDVA and TPJUST
// stations, stoppoints-discovery and lines-discovery. Only the number of
// entries is cut down. The landmarks are public places of the network (Hôtel
// de Ville, Palais de Justice, Quinconces), never a personal stop.
// -----------------------------------------------------------------------------

/** The reference instant of every test: 2026-10-12 17:53 in Bordeaux. */
export const NOW = Date.parse('2026-10-12T15:53:00Z');

const at = (offsetSeconds) => new Date(NOW + offsetSeconds * 1000).toISOString();
const wrap = (value) => ({ value });
const texts = (...values) => values.map((value) => ({ value, lang: 'fr' }));

/** Hôtel de Ville (tram) and its neighbours, a depot, a school-only stop. */
export function stopPointsPayload() {
  const quay = (id, area, name, lines, lat, lon) => ({
    StopPointRef: wrap(`bordeaux:StopPoint:BP:${id}:LOC`),
    ...(area ? { StopAreaRef: wrap(`bordeaux:StopPoint:BP:${area}:LOC`) } : {}),
    StopName: { value: name, lang: 'fr' },
    Lines: lines.map((line) => wrap(`bordeaux:Line:${line}:LOC`)),
    Location: { latitude: lat, longitude: lon },
  });
  return {
    Siri: {
      StopPointsDelivery: {
        ResponseTimestamp: '2026-10-10T22:51:57Z',
        Version: '2.0',
        Status: true,
        AnnotatedStopPointRef: [
          quay('3718', 'THDVA', 'Hôtel de Ville', ['59', '164'], 44.83733, -0.577188),
          quay('3719', 'THDVA', 'Hôtel de Ville', ['59', '164'], 44.837305, -0.577136),
          quay('3720', 'TPJUST', 'Palais de Justice', ['59', '164'], 44.836299, -0.581492),
          quay('3721', 'TPJUST', 'Palais de Justice', ['59', '164'], 44.836253, -0.581527),
          quay('3647', 'BMUNIC', 'Quinconces', ['02', '501'], 44.844628, -0.573903),
          quay('3648', 'BQUIOR', 'Quinconces', ['02', '506'], 44.843853, -0.573905),
          quay('9999', 'BSCOL', 'Collège Test', ['810'], 44.8372, -0.5772),
          // An old stop: no area, no line.
          quay('2303', null, 'Belcier', [], 44.82578205, -0.55458181),
          // A depot: an area-less quay of no line either.
          quay('11001', null, 'DEPOT BACALAN', [], 44.86686796, -0.54788223),
        ],
      },
    },
  };
}

export function linesPayload() {
  const line = (id, name, code, destinations) => ({
    LineRef: wrap(`bordeaux:Line:${id}:LOC`),
    LineName: texts(name),
    LineCode: { value: code, lang: 'fr' },
    Destinations: destinations.map(([direction, place]) => ({
      PlaceName: texts(place),
      DirectionRef: wrap(direction),
    })),
  });
  return {
    Siri: {
      LinesDelivery: {
        ResponseTimestamp: '2026-10-12T17:24:17Z',
        Version: '2.0',
        Status: true,
        AnnotatedLineRef: [
          line('02', 'Lianes 2', '2', [
            ['0', 'EYSINES Cantinolle / LE TAILLAN La Boétie'],
            ['1', 'BORDEAUX Quinconces'],
          ]),
          line('59', 'Tram A', 'A', [
            ['0', 'Hôpital Pellegrin / Le Haillan Rostand'],
            ['1', 'Cenon Gare / La Gardette / Thiers Benauge'],
          ]),
          line('164', 'Tram F', 'F', [
            ['0', 'Mérignac Aéroport'],
            ['1', 'Gare de Bègles'],
          ]),
          line('501', 'TBNight N8', 'N1', [['0', 'Les Aubiers']]),
          line('506', 'TBNight N6', 'N6', [['0', 'Galin Terminus']]),
          line('810', 'SCODI S10', 'S10', [
            ['0', 'Lycée Sud Médoc'],
            ['1', 'Quatre Lagunes'],
          ]),
          line('104', 'Navette Tram 104', '104', []),
          line('97', 'Ligne 97 (HLP)', '97', []),
        ],
      },
    },
  };
}

/**
 * One visit of a stop-monitoring answer.
 * @param {{ quay: string, line: string, direction: string, directionName: string,
 *   destination: string, journey: string, aimed?: number, expected?: number,
 *   arrivalOnly?: boolean, recorded?: boolean }} visit offsets in seconds from NOW
 */
export function visit({
  quay,
  line,
  direction,
  directionName,
  destination,
  journey,
  aimed,
  expected,
  arrivalOnly = false,
  recorded = true,
}) {
  const call = { StopPointName: texts('Hôtel de Ville'), Order: 21 };
  if (arrivalOnly) {
    call.AimedArrivalTime = at(aimed);
    if (expected !== undefined) call.ExpectedArrivalTime = at(expected);
  } else {
    call.AimedArrivalTime = at(aimed);
    call.AimedDepartureTime = at(aimed);
    if (expected !== undefined) {
      call.ExpectedArrivalTime = at(expected);
      call.ExpectedDepartureTime = at(expected);
    }
  }
  return {
    ...(recorded ? { RecordedAtTime: at(-16) } : {}),
    MonitoringRef: wrap(`bordeaux:StopPoint:BP:${quay}:LOC`),
    MonitoredVehicleJourney: {
      LineRef: wrap(`bordeaux:Line:${line}:LOC`),
      DirectionRef: wrap(direction),
      FramedVehicleJourneyRef: {
        DatedVehicleJourneyRef: `bordeaux:ServiceJourney:${journey}`,
      },
      DirectionName: texts(directionName),
      DestinationRef: wrap('bordeaux:StopPoint:BP:7091:LOC'),
      DestinationName: texts(destination),
      MonitoredCall: call,
    },
  };
}

const A0 = { line: '59', direction: '0', directionName: 'Hôpital Pellegrin / Le Haillan Rostand' };
const A1 = {
  line: '59',
  direction: '1',
  directionName: 'Cenon Gare / La Gardette / Thiers Benauge',
};

/** The visits of Hôtel de Ville at NOW, unordered like the real answer. */
export function hotelDeVilleVisits() {
  return [
    visit({ ...A1, quay: '3719', destination: 'Cenon Gare', journey: 'A-3', aimed: 206 }),
    visit({
      ...A0,
      quay: '3718',
      destination: 'Le Haillan Rostand',
      journey: 'A-2',
      aimed: -291,
      expected: 151,
    }),
    visit({
      ...A1,
      quay: '3719',
      destination: 'La Gardette',
      journey: 'A-1',
      aimed: 56,
      expected: 108,
    }),
    // The same vehicle listed twice: kept once.
    visit({
      ...A1,
      quay: '3719',
      destination: 'La Gardette',
      journey: 'A-1',
      aimed: 56,
      expected: 108,
    }),
    visit({
      line: '164',
      direction: '0',
      directionName: 'Mérignac Aéroport',
      quay: '3718',
      destination: 'Mérignac Aéroport',
      journey: 'F-1',
      aimed: 300,
      expected: 360,
    }),
    // A tram ending its trip here: nobody boards it.
    visit({
      ...A0,
      quay: '3718',
      destination: 'Hôtel de Ville',
      journey: 'A-9',
      aimed: 120,
      arrivalOnly: true,
    }),
    // Gone five minutes ago.
    visit({
      ...A0,
      quay: '3718',
      destination: 'Le Haillan Rostand',
      journey: 'A-0',
      aimed: -360,
      expected: -300,
    }),
    visit({
      ...A0,
      quay: '3718',
      destination: 'Hôpital Pellegrin',
      journey: 'A-4',
      aimed: 540,
      expected: 545,
      recorded: false,
    }),
  ];
}

/** A stop-monitoring answer. */
export function stopMonitoringPayload(visits = hotelDeVilleVisits()) {
  return {
    Siri: {
      ServiceDelivery: {
        ResponseTimestamp: new Date(NOW).toISOString(),
        Version: '2.0',
        ProducerRef: 'bordeaux',
        ResponseMessageIdentifier: 'bordeaux:StopMonitoring:4196748',
        StopMonitoringDelivery: [
          {
            ResponseTimestamp: new Date(NOW).toISOString(),
            Version: '2.0',
            Status: true,
            MonitoredStopVisit: visits,
          },
        ],
      },
    },
  };
}
