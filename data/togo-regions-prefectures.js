// data/togo-regions-prefectures.js
//
// Togo's administrative divisions: 5 regions subdivided into 39 prefectures
// (a 40th "commune" — Golfe/Lomé — is folded into the Golfe prefecture
// below, matching how shipping zones need to reference it).
//
// Shape mirrors nigeria-states-lgas.js on purpose (`state`/`lga` field
// names) so the same shipping-zone validation code can consume either
// country's data through the generic lookup in utils/countryGeoData.js
// without needing per-country branching — `state` here means "region" and
// `lga` means "prefecture".
//
// Source: regions confirmed via ISO 3166-2:TG (Centrale, Kara, Maritime,
// Plateaux, Savanes); prefecture-per-region breakdown and chef-lieux cross
// checked against Togo's 2019 local-elections prefecture/commune list.

export const togoRegionsPrefectures = [
  {
    state: 'Maritime',
    capital: 'Lomé',
    region: 'Maritime',
    description:
      'Togo\u2019s southernmost region, on the Atlantic coast, home to the national capital Lomé.',
    no_of_lga: 8,
    lga: [
      'Golfe',
      'Agoè-Nyivé',
      'Lacs',
      'Bas-Mono',
      'Vo',
      'Yoto',
      'Zio',
      'Avé',
    ],
    popularCities: ['Lomé', 'Aného', 'Tsévié', 'Vogan', 'Tabligbo'],
  },
  {
    state: 'Plateaux',
    capital: 'Atakpamé',
    region: 'Plateaux',
    description:
      'Togo\u2019s largest region by area, known for coffee, cocoa and cotton farming.',
    no_of_lga: 12,
    lga: [
      'Ogou',
      'Anié',
      'Est-Mono',
      'Kloto',
      'Danyi',
      'Agou',
      'Haho',
      'Moyen-Mono',
      'Wawa',
      'Amou',
      'Akébou',
      'Kpélé',
    ],
    popularCities: ['Atakpamé', 'Kpalimé', 'Notsé', 'Badou', 'Amlamé'],
  },
  {
    state: 'Centrale',
    capital: 'Sokodé',
    region: 'Centrale',
    description:
      'Togo\u2019s least-populated region; Sokodé is the country\u2019s second-largest city.',
    no_of_lga: 5,
    lga: ['Tchaoudjo', 'Tchamba', 'Sotouboua', 'Blitta', 'Mô'],
    popularCities: ['Sokodé', 'Tchamba', 'Sotouboua', 'Blitta-Gare'],
  },
  {
    state: 'Kara',
    capital: 'Kara',
    region: 'Kara',
    description: 'Northern region centred on the city of Kara.',
    no_of_lga: 7,
    lga: ['Kozah', 'Binah', 'Doufelgou', 'Assoli', 'Bassar', 'Dankpen', 'Kéran'],
    popularCities: ['Kara', 'Bassar', 'Niamtougou', 'Bafilo', 'Kanté'],
  },
  {
    state: 'Savanes',
    capital: 'Dapaong',
    region: 'Savanes',
    description: 'Togo\u2019s northernmost region, bordering Burkina Faso.',
    no_of_lga: 7,
    lga: ['Tône', 'Cinkassé', 'Kpendjal', 'Kpendjal-Ouest', 'Tandjouaré', 'Oti', 'Oti-Sud'],
    popularCities: ['Dapaong', 'Cinkassé', 'Mango', 'Tandjouaré', 'Mandouri'],
  },
];

export default togoRegionsPrefectures;
