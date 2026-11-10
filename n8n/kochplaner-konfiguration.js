// ============================================================
// KONFIGURATION – nur hier etwas ändern
// ============================================================
const CFG = {
  // Welche KI? 'gemini' oder 'anthropic'
  anbieter: 'gemini',

  // Gemini-Schlüssel (https://aistudio.google.com → „Get API key“)
  geminiApiKey: 'HIER_DEINEN_GEMINI_KEY_EINTRAGEN',
  // 'auto' = neuestes verfügbares Flash-Modell wird automatisch gewählt
  geminiModell: 'auto',

  // Alternativ Anthropic (https://console.anthropic.com → API Keys)
  anthropicApiKey: 'HIER_DEINEN_API_KEY_EINTRAGEN',
  modell: 'claude-sonnet-5-5',

  // Märkte, deren Angebote als TEXT auf der Webseite stehen.
  // url leer lassen = Markt wird nicht online abgerufen.
  // Tipp EDEKA/REWE/Kaufland: Im Browser deinen Markt wählen, auf die
  // Angebotsseite gehen und die Adresse aus der Adresszeile hier eintragen.
  textQuellen: {
    aldi:     'https://www.aldi-sued.de/de/angebote.html',
    norma:    'https://www.norma-online.de/de/angebote/',
    edeka:    'https://www.edeka.de/eh/angebote.jsp',
    rewe:     'https://www.rewe.de/angebote/',
    kaufland: 'https://filiale.kaufland.de/angebote/aktuelle-woche.html'
  },

  // Übersichtsseiten, auf denen der Link zum aktuellen Prospekt gesucht wird
  prospektSeiten: {
    lidl:  'https://www.lidl.de/c/billiger-montag/a10006065',
    netto: 'https://www.netto-online.de/ueber-netto/Online-Prospekte.chtm',
    penny: 'https://www.penny.de/angebote#handout',
    denns: 'https://www.biomarkt.de/'
  }
};

return $input.all().map(i => ({ json: Object.assign({}, i.json, { cfg: CFG }) }));
