// data/italy-regions.js
//
// Italy's administrative divisions: 20 regions. Each region is further
// subdivided into provinces/metropolitan cities (107 total) — that
// province-level detail is NOT included yet (deferred; see
// togo-regions-prefectures.js for the full-depth pattern to follow when
// Italy's shipping-zone rollout needs province-level coverage). Until
// then, `lga` is seeded with just the regional capital so shipping zones
// for Italy can be created at region granularity today without validation
// errors, and can be extended to real province lists later without a
// schema change.
//
// Shape mirrors nigeria-states-lgas.js (`state`/`lga` field names) so the
// same shipping-zone validation code can consume any country's data
// through the generic lookup in utils/countryGeoData.js.

export const italyRegions = [
  { state: 'Abruzzo', capital: "L'Aquila", region: 'Central Italy', description: '', no_of_lga: 1, lga: ["L'Aquila"], popularCities: ['Pescara'] },
  { state: 'Aosta Valley', capital: 'Aosta', region: 'Northwest Italy', description: '', no_of_lga: 1, lga: ['Aosta'], popularCities: [] },
  { state: 'Apulia', capital: 'Bari', region: 'South Italy', description: '', no_of_lga: 1, lga: ['Bari'], popularCities: ['Taranto', 'Lecce'] },
  { state: 'Basilicata', capital: 'Potenza', region: 'South Italy', description: '', no_of_lga: 1, lga: ['Potenza'], popularCities: ['Matera'] },
  { state: 'Calabria', capital: 'Catanzaro', region: 'South Italy', description: '', no_of_lga: 1, lga: ['Catanzaro'], popularCities: ['Reggio Calabria'] },
  { state: 'Campania', capital: 'Naples', region: 'South Italy', description: '', no_of_lga: 1, lga: ['Naples'], popularCities: ['Salerno'] },
  { state: 'Emilia-Romagna', capital: 'Bologna', region: 'Northeast Italy', description: '', no_of_lga: 1, lga: ['Bologna'], popularCities: ['Parma', 'Modena'] },
  { state: 'Friuli-Venezia Giulia', capital: 'Trieste', region: 'Northeast Italy', description: '', no_of_lga: 1, lga: ['Trieste'], popularCities: ['Udine'] },
  { state: 'Lazio', capital: 'Rome', region: 'Central Italy', description: 'Home to Rome, Italy\u2019s capital.', no_of_lga: 1, lga: ['Rome'], popularCities: ['Rome'] },
  { state: 'Liguria', capital: 'Genoa', region: 'Northwest Italy', description: '', no_of_lga: 1, lga: ['Genoa'], popularCities: [] },
  { state: 'Lombardy', capital: 'Milan', region: 'Northwest Italy', description: 'Italy\u2019s most populous region.', no_of_lga: 1, lga: ['Milan'], popularCities: ['Milan', 'Bergamo'] },
  { state: 'Marche', capital: 'Ancona', region: 'Central Italy', description: '', no_of_lga: 1, lga: ['Ancona'], popularCities: [] },
  { state: 'Molise', capital: 'Campobasso', region: 'South Italy', description: '', no_of_lga: 1, lga: ['Campobasso'], popularCities: [] },
  { state: 'Piedmont', capital: 'Turin', region: 'Northwest Italy', description: '', no_of_lga: 1, lga: ['Turin'], popularCities: [] },
  { state: 'Sardinia', capital: 'Cagliari', region: 'Insular Italy', description: '', no_of_lga: 1, lga: ['Cagliari'], popularCities: [] },
  { state: 'Sicily', capital: 'Palermo', region: 'Insular Italy', description: '', no_of_lga: 1, lga: ['Palermo'], popularCities: ['Catania'] },
  { state: 'Trentino-Alto Adige', capital: 'Trento', region: 'Northeast Italy', description: '', no_of_lga: 1, lga: ['Trento'], popularCities: ['Bolzano'] },
  { state: 'Tuscany', capital: 'Florence', region: 'Central Italy', description: '', no_of_lga: 1, lga: ['Florence'], popularCities: ['Pisa', 'Siena'] },
  { state: 'Umbria', capital: 'Perugia', region: 'Central Italy', description: '', no_of_lga: 1, lga: ['Perugia'], popularCities: [] },
  { state: 'Veneto', capital: 'Venice', region: 'Northeast Italy', description: '', no_of_lga: 1, lga: ['Venice'], popularCities: ['Verona', 'Padua'] },
];

export default italyRegions;
