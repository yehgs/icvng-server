// data/benin-departments.js
//
// Benin's administrative divisions: 12 departments. Each department is
// further subdivided into communes (77 total, then arrondissements) — that
// commune-level detail is NOT included yet (deferred; see
// togo-regions-prefectures.js for the full-depth pattern to follow when
// Benin's shipping-zone rollout needs commune-level coverage). Until then,
// `lga` is seeded with just the department capital so shipping zones for
// Benin can be created at department granularity today without validation
// errors, and can be extended to real commune lists later without a
// schema change.
//
// Shape mirrors nigeria-states-lgas.js (`state`/`lga` field names) so the
// same shipping-zone validation code can consume any country's data
// through the generic lookup in utils/countryGeoData.js.

export const beninDepartments = [
  { state: 'Alibori', capital: 'Kandi', region: 'North', description: '', no_of_lga: 1, lga: ['Kandi'], popularCities: ['Kandi', 'Malanville'] },
  { state: 'Atacora', capital: 'Natitingou', region: 'North', description: '', no_of_lga: 1, lga: ['Natitingou'], popularCities: ['Natitingou'] },
  { state: 'Atlantique', capital: 'Allada', region: 'South', description: '', no_of_lga: 1, lga: ['Allada'], popularCities: ['Ouidah', 'Abomey-Calavi'] },
  { state: 'Borgou', capital: 'Parakou', region: 'North', description: '', no_of_lga: 1, lga: ['Parakou'], popularCities: ['Parakou'] },
  { state: 'Collines', capital: 'Dassa-Zoumè', region: 'South', description: '', no_of_lga: 1, lga: ['Dassa-Zoumè'], popularCities: ['Savalou'] },
  { state: 'Couffo', capital: 'Aplahoué', region: 'South', description: '', no_of_lga: 1, lga: ['Aplahoué'], popularCities: ['Dogbo'] },
  { state: 'Donga', capital: 'Djougou', region: 'North', description: '', no_of_lga: 1, lga: ['Djougou'], popularCities: ['Djougou'] },
  { state: 'Littoral', capital: 'Cotonou', region: 'South', description: 'Benin\u2019s economic capital and largest city.', no_of_lga: 1, lga: ['Cotonou'], popularCities: ['Cotonou'] },
  { state: 'Mono', capital: 'Lokossa', region: 'South', description: '', no_of_lga: 1, lga: ['Lokossa'], popularCities: ['Lokossa', 'Grand-Popo'] },
  { state: 'Ouémé', capital: 'Porto-Novo', region: 'South', description: 'Home to Porto-Novo, Benin\u2019s official capital.', no_of_lga: 1, lga: ['Porto-Novo'], popularCities: ['Porto-Novo'] },
  { state: 'Plateau', capital: 'Pobè', region: 'South', description: '', no_of_lga: 1, lga: ['Pobè'], popularCities: ['Pobè', 'Sakété'] },
  { state: 'Zou', capital: 'Abomey', region: 'South', description: '', no_of_lga: 1, lga: ['Abomey'], popularCities: ['Abomey', 'Bohicon'] },
];

export default beninDepartments;
