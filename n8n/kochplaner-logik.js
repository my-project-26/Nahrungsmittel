// ============================================================
// KOCHPLANER-LOGIK
// Aktionen: ping | angebote | aktualisieren | flyer | vorrat | rezepte
// ============================================================
const eingang = $input.first().json;
const cfg = eingang.cfg;
let body = eingang.body || {};
if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
const aktion = body.aktion || 'angebote';
const vomZeitplan = eingang.cron === true;
const store = $getWorkflowStaticData('global');
const helpers = this.helpers;

const HEUTE = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
const BROWSER_HEADER = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'de-DE,de;q=0.9'
};
const START = Date.now();
// Unterseiten mit weiteren Angeboten (z. B. NORMA: "ab Montag", "Obst & Gemüse")
const UNTERSEITEN = {
  norma: /href="((?:https:\/\/www\.norma-online\.de)?\/de\/angebote\/(?:ab-[^"#?]+|obst-und-gemuese\/[^"#?]*))"/g
};
const TEXT_MAERKTE = ['aldi', 'norma', 'edeka', 'rewe', 'kaufland'];
const PROSPEKT_MAERKTE = ['lidl', 'netto', 'penny', 'denns'];

// ------------------------------------------------------------
// Hilfsfunktionen
// ------------------------------------------------------------
// Einheitlicher KI-Aufruf: content = Liste aus {type:'text',text} und {type:'image',source:{media_type,data}}
async function claude(content, maxTokens) {
  return (cfg.anbieter || 'gemini') === 'anthropic' ? anthropicAufruf(content, maxTokens) : geminiAufruf(content, maxTokens);
}

async function anthropicAufruf(content, maxTokens) {
  if (!cfg.anthropicApiKey || cfg.anthropicApiKey.startsWith('HIER_')) {
    throw new Error('Kein Anthropic-API-Schlüssel im Node „Konfiguration“ eingetragen.');
  }
  const res = await helpers.httpRequest({
    method: 'POST',
    url: 'https://api.anthropic.com/v1/messages',
    headers: { 'x-api-key': cfg.anthropicApiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: { model: cfg.modell, max_tokens: maxTokens || 8000, messages: [{ role: 'user', content }] },
    json: true,
    timeout: 240000
  });
  return (res.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
}

// Liste der Flash-Modelle, neuestes zuerst (wird einmal pro Tag geholt)
async function geminiModelle() {
  if (cfg.geminiModell && cfg.geminiModell !== 'auto') return [cfg.geminiModell, 'gemini-flash-latest'];
  if (Array.isArray(store.geminiModelle) && store.geminiModelleTag === HEUTE) return store.geminiModelle;
  let namen = [];
  try {
    const res = await helpers.httpRequest({
      method: 'GET', url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200',
      headers: { 'x-goog-api-key': cfg.geminiApiKey }, json: true, timeout: 30000
    });
    namen = (res.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => m.name.replace('models/', ''))
      .filter(n => /^gemini-\d+(\.\d+)?-flash(-lite)?$/.test(n) || n === 'gemini-flash-latest');
  } catch (e) { /* Liste nicht verfügbar → Standard */ }
  // Sortierung: Alias "flash-latest" zuerst, dann Flash (neueste zuerst), dann Flash-Lite
  const rang = n => (n === 'gemini-flash-latest' ? 1000 : 0) + (n.endsWith('-lite') ? 0 : 100) + parseFloat((n.match(/^gemini-(\d+(?:\.\d+)?)/) || [0, 0])[1]);
  namen.sort((x, y) => rang(y) - rang(x));
  ['gemini-flash-latest', 'gemini-2.5-flash'].forEach(n => { if (!namen.includes(n)) namen.push(n); });
  store.geminiModelle = namen; store.geminiModelleTag = HEUTE;
  return namen;
}

const warte = ms => (typeof setTimeout === 'function' ? new Promise(r => setTimeout(r, ms)) : Promise.resolve());

async function geminiAufruf(content, maxTokens) {
  if (!cfg.geminiApiKey || cfg.geminiApiKey.startsWith('HIER_')) {
    throw new Error('Kein Gemini-API-Schlüssel im Node „Konfiguration“ eingetragen.');
  }
  const parts = content.map(c => c.type === 'image'
    ? { inline_data: { mime_type: c.source.media_type, data: c.source.data } }
    : { text: c.text });
  // Bevorzugtes Modell vom letzten erfolgreichen Aufruf zuerst
  let modelle = await geminiModelle();
  if (store.geminiOk && modelle.includes(store.geminiOk)) modelle = [store.geminiOk].concat(modelle.filter(m => m !== store.geminiOk));
  const fehler = [];
  for (const modell of modelle.slice(0, 8)) {
    if (Date.now() - START > 170000) break; // Zeitbudget, damit n8n den Code-Node nicht abbricht
    for (let versuch = 1; versuch <= 2; versuch++) {
      try {
        const res = await helpers.httpRequest({
          method: 'POST',
          url: 'https://generativelanguage.googleapis.com/v1beta/models/' + modell + ':generateContent',
          headers: { 'x-goog-api-key': cfg.geminiApiKey, 'content-type': 'application/json' },
          body: { contents: [{ role: 'user', parts }], generationConfig: { temperature: 0, maxOutputTokens: Math.max(maxTokens || 8000, 16000) } },
          json: true,
          timeout: 110000
        });
        const kandidat = (res.candidates || [])[0];
        if (!kandidat) throw Object.assign(new Error('keine Antwort'), { httpCode: 'leer' });
        store.geminiOk = modell;
        return ((kandidat.content && kandidat.content.parts) || []).filter(p => p.text && !p.thought).map(p => p.text).join('');
      } catch (e) {
        const code = String(e.httpCode || (e.response && e.response.status) || '');
        fehler.push(modell + ': ' + (code || e.message));
        if (code === '400' || code === '401' || code === '403') throw new Error('Gemini lehnt den Schlüssel/die Anfrage ab (HTTP ' + code + '). Schlüssel prüfen.');
        // 503 überlastet / 429 Kontingent / 404 Modell nicht verfügbar → kurz warten bzw. nächstes Modell
        if ((code === '503' || code === '500') && versuch === 1) { await warte(3000); continue; }
        break;
      }
    }
  }
  throw new Error('Gemini gerade nicht verfügbar (' + fehler.join(' · ') + '). Bitte in ein paar Minuten erneut versuchen.');
}

function jsonAus(text) {
  const s = String(text).replace(/```json/gi, '').replace(/```/g, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b < 0) throw new Error('KI-Antwort enthielt kein JSON.');
  return JSON.parse(s.slice(a, b + 1));
}

function htmlZuText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr|\/section|\/article)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&euro;/g, '€').replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t\r]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

// "1,89" | "1.89" | "-.99" | "–,99" | ".99" -> Cent (Integer) oder null
function preisZuCent(roh) {
  if (roh === null || roh === undefined) return null;
  let s = String(roh).replace(/€|EUR/gi, '').replace(/\s/g, '').replace(/[–—]/g, '-');
  s = s.replace(/^-(?=[.,])/, '0').replace(/^(?=[.,])/, '0');
  const m = s.match(/^(\d{1,4})[.,](\d{2})$/) || s.match(/^(\d{1,4})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 100 + (m[2] ? parseInt(m[2], 10) : 0);
}

function preisRegex(cent) {
  const e = Math.floor(cent / 100), c = String(cent % 100).padStart(2, '0');
  const eTeil = e === 0 ? '(?:0|-|–|—)?\\s*' : String(e) + '\\s*';
  return new RegExp('(?<![\\d.,])' + eTeil + '[.,]\\s*' + c + '(?!\\d)', 'g');
}

function stichwoerter(produkt) {
  return String(produkt || '').toLowerCase()
    .replace(/[^a-zäöüß0-9 ]/g, ' ')
    .split(/\s+/).filter(w => w.length >= 4).slice(0, 6);
}

// Preis steht wörtlich im Seitentext UND in der Nähe des Produktnamens?
function preisImText(textKlein, cent, produkt) {
  const worte = stichwoerter(produkt);
  if (!worte.length) return false;
  const re = preisRegex(cent);
  let m;
  while ((m = re.exec(textKlein)) !== null) {
    // Produktname steht in Prospekten/Webseiten vor dem Preis
    const von = Math.max(0, m.index - 300), bis = m.index + 80;
    const umfeld = textKlein.slice(von, bis);
    if (worte.some(w => umfeld.includes(w))) return true;
  }
  return false;
}

// Menge in kg bzw. l
function mengeBasis(menge) {
  const s = String(menge || '').toLowerCase().replace(',', '.');
  let faktor = 1;
  const mal = s.match(/(\d+)\s*[x×]\s*/);
  if (mal) faktor = parseInt(mal[1], 10);
  const m = s.match(/(\d+(?:\.\d+)?)\s*(kg|g|ml|cl|l)\b/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const umr = { kg: 1, g: 0.001, l: 1, ml: 0.001, cl: 0.01 }[m[2]];
  return n * umr * faktor;
}
// Grundpreis in € pro kg bzw. l (+ Rundungstoleranz)
function grundpreisBasis(gp) {
  const s = String(gp || '').toLowerCase().replace(/\s/g, '');
  let m = s.match(/1(kg|l)=?(\d+)[.,](\d{2})/) || s.match(/(kg|l)[-\s]*preis:?(\d+)[.,](\d{2})/);
  if (m) return { wert: parseInt(m[2], 10) + parseInt(m[3], 10) / 100, toleranz: 0.006 };
  m = s.match(/100(g|ml)=?(\d+)[.,](\d{2})/);
  if (m) return { wert: (parseInt(m[2], 10) + parseInt(m[3], 10) / 100) * 10, toleranz: 0.051 };
  return null;
}
// 'ok' | 'falsch' | 'na'
function grundpreisPruefung(cent, menge, grundpreis) {
  const mb = mengeBasis(menge), gb = grundpreisBasis(grundpreis);
  if (!mb || !gb || cent === null) return 'na';
  const gerechnet = (cent / 100) / mb;
  // Grundpreise sind auf Cent gerundet → kleine Toleranz für Rundung
  return Math.abs(gerechnet - gb.wert) <= Math.max(gb.toleranz, gb.wert * 0.004) ? 'ok' : 'falsch';
}

function zeilenAngebote(text) {
  // Format je Zeile: produkt | menge | preis | grundpreis | gueltigVon | gueltigBis
  return String(text).split('\n').map(z => z.trim()).filter(z => z.includes('|') && !/^produkt\s*\|/i.test(z))
    .map(z => z.split('|').map(t => t.trim()))
    .filter(t => t.length >= 3)
    .map(t => ({ produkt: t[0], menge: t[1] || '', preisRoh: t[2], grundpreis: t[3] || '', gueltigVon: /^\d{4}-\d{2}-\d{2}$/.test(t[4] || '') ? t[4] : '', gueltigBis: /^\d{4}-\d{2}-\d{2}$/.test(t[5] || '') ? t[5] : '' }));
}

const ANWEISUNG_ZEILEN =
  'Gib NUR Zeilen in diesem Format aus, eine Zeile pro Angebot, ohne Überschrift, ohne Erklärung:\n' +
  'produkt | menge | preis | grundpreis | gueltigVon | gueltigBis\n' +
  '- produkt: Marke + Produktname wie angegeben (z. B. "GUT BIO Datteltomaten")\n' +
  '- menge: Packungsgröße wie angegeben (z. B. "500 g", "6 x 1,5 l"), sonst leer\n' +
  '- preis: der Angebotspreis GENAU so geschrieben wie in der Quelle, nur Zahl mit Komma (z. B. "1,89" oder "-,99"). Nie runden, nie raten. Bei "ab"-Preisen oder Mehrfachpreisen ("2 für 3 €") die Zeile weglassen.\n' +
  '- grundpreis: wie angegeben (z. B. "1 kg = 3,78"), sonst leer\n' +
  '- gueltigVon / gueltigBis: Datum im Format JJJJ-MM-TT, aus Überschriften wie "ab Montag, 9.11." ableiten (heute ist ' + HEUTE + '), sonst leer\n' +
  'Nur Lebensmittel und Getränke, keine Non-Food-Artikel. Wenn ein Preis nicht eindeutig lesbar ist: Zeile weglassen.';

function kurzId(s) { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h).toString(36); }

// ------------------------------------------------------------
// Angebote von einer Text-Webseite holen und prüfen
// ------------------------------------------------------------
function fehlerText(e) {
  const code = e.httpCode || e.statusCode || (e.response && (e.response.status || e.response.statusCode)) || (e.cause && e.cause.code) || e.code || '';
  const msg = String(e.message || e).replace(/\s+/g, ' ').slice(0, 120);
  return (code ? 'Code ' + code + ' – ' : '') + msg;
}

async function holeSeite(url) {
  return String(await helpers.httpRequest({ method: 'GET', url, headers: BROWSER_HEADER, timeout: 30000, json: false }));
}

async function textQuelleAbrufen(markt, url) {
  let html;
  try { html = await holeSeite(url); }
  catch (e) { return { quelle: { markt, status: 'fehler', fehler: 'Seite nicht abrufbar (' + fehlerText(e) + ')', anzahl: 0 }, angebote: [] }; }

  // Seiten sammeln: Hauptseite + ggf. Unterseiten (2 Ebenen, max. 20)
  const seiten = [{ url, text: htmlZuText(html) }];
  const re = UNTERSEITEN[markt];
  if (re) {
    const basis = (String(url).match(/^https?:\/\/[^\/]+/) || [''])[0]; // ohne URL-Klasse (im n8n-Sandbox nicht vorhanden)
    const gesehen = new Set([url]);
    let ebene = [html];
    for (let tiefe = 0; tiefe < 2 && seiten.length < 14; tiefe++) {
      const links = [];
      for (const h of ebene) for (const t of h.matchAll(new RegExp(re.source, 'g'))) {
        const l = t[1].startsWith('http') ? t[1] : basis + t[1];
        if (!gesehen.has(l)) { gesehen.add(l); links.push(l); }
      }
      const neue = links.slice(0, 14 - seiten.length);
      const geladen = await Promise.all(neue.map(l => holeSeite(l).then(h => ({ url: l, h })).catch(() => null)));
      ebene = [];
      for (const g of geladen) if (g) { seiten.push({ url: g.url, text: htmlZuText(g.h) }); ebene.push(g.h); }
    }
  }
  const gesamt = seiten.reduce((n, p) => n + p.text.length, 0);
  if (gesamt < 500) {
    return { quelle: { markt, status: 'fehler', fehler: 'Seite liefert keinen Text (wird per JavaScript geladen)', anzahl: 0 }, angebote: [] };
  }

  // In Pakete à max. 80.000 Zeichen aufteilen (max. 3 KI-Aufrufe, parallel)
  const pakete = []; let akt = '';
  for (const p of seiten) {
    const t = p.text.slice(0, 80000);
    if (akt.length + t.length > 80000 && akt) { pakete.push(akt); akt = ''; }
    akt += '\n\n### Seite: ' + p.url + '\n' + t;
  }
  if (akt) pakete.push(akt);

  let verworfen = 0, kiFehler = 0;
  const gefunden = new Map();
  await Promise.all(pakete.slice(0, 3).map(async paket => {
    let antwort;
    try {
      antwort = await claude([{ type: 'text', text: 'Hier ist der Text der Angebotsseite(n) von ' + markt.toUpperCase() + ':\n\n<<<\n' + paket + '\n>>>\n\n' + ANWEISUNG_ZEILEN }], 12000);
    } catch (e) { kiFehler++; return; }
    const klein = paket.toLowerCase();
    for (const a of zeilenAngebote(antwort)) {
      const cent = preisZuCent(a.preisRoh);
      // Sicherheitsprüfung: Preis muss wörtlich im Seitentext stehen, nahe am Produktnamen
      if (cent === null || cent <= 0 || !preisImText(klein, cent, a.produkt)) { verworfen++; continue; }
      const gp = grundpreisPruefung(cent, a.menge, a.grundpreis);
      if (gp === 'falsch') { verworfen++; continue; }
      const id = markt + '_' + kurzId(a.produkt.toLowerCase() + a.menge + cent);
      if (!gefunden.has(id)) gefunden.set(id, {
        id, markt, produkt: a.produkt, menge: a.menge, preis: cent / 100, grundpreis: a.grundpreis,
        gueltigVon: a.gueltigVon, gueltigBis: a.gueltigBis, quelle: 'text', geprueft: true, grundpreisCheck: gp
      });
    }
  }));
  const angebote = Array.from(gefunden.values());
  if (!angebote.length) {
    return { quelle: { markt, status: 'fehler', fehler: kiFehler ? 'KI nicht erreichbar' : 'Keine prüfbaren Angebote im Seitentext gefunden', anzahl: 0, verworfen, seiten: seiten.length }, angebote: [] };
  }
  return { quelle: { markt, status: 'text', anzahl: angebote.length, verworfen, seiten: seiten.length }, angebote };
}

// ------------------------------------------------------------
// Aktuellen Prospekt-Link suchen
// ------------------------------------------------------------
async function prospektLinkSuchen(markt, url) {
  if (markt !== 'lidl') return url;
  try {
    const html = await helpers.httpRequest({ method: 'GET', url, headers: BROWSER_HEADER, timeout: 30000, json: false });
    const treffer = Array.from(String(html).matchAll(/href="([^"]*\/l\/prospekte\/aktionsprospekt-(\d{2})-(\d{2})-(\d{4})-(\d{2})-(\d{2})-(\d{4})[^"]*)"/g));
    let bester = null;
    for (const t of treffer) {
      const von = t[4] + '-' + t[3] + '-' + t[2], bis = t[7] + '-' + t[6] + '-' + t[5];
      const link = t[1].startsWith('http') ? t[1] : 'https://www.lidl.de' + t[1];
      if (von <= HEUTE && HEUTE <= bis) { bester = link; break; }
      if (!bester) bester = link;
    }
    return (bester || url).replace(/&amp;/g, '&');
  } catch (e) { return url; }
}

// ------------------------------------------------------------
// Aktionen
// ------------------------------------------------------------
function leererStand() { return { stand: null, quellen: [], angebote: [], prospektLinks: {} }; }

// Einen einzelnen Text-Markt abrufen und in den gespeicherten Stand einsortieren
async function marktAktualisieren(markt) {
  if (!TEXT_MAERKTE.includes(markt)) throw new Error('Markt ' + markt + ' wird nicht online abgerufen.');
  const url = cfg.textQuellen[markt];
  const e = url ? await textQuelleAbrufen(markt, url)
                : { quelle: { markt, status: 'fehler', fehler: 'Keine Adresse in der Konfiguration', anzahl: 0 }, angebote: [] };
  const d = store.angebote || leererStand();
  d.quellen = (d.quellen || []).filter(q => q.markt !== markt).concat(e.quelle);
  d.angebote = (d.angebote || []).filter(x => x.markt !== markt).concat(e.angebote);
  d.stand = new Date().toISOString();
  store.angebote = d;
  return { quelle: e.quelle, daten: d };
}

// Prospekt-Links und Prospekt-Märkte aktualisieren (schnell, ohne KI)
async function linksAktualisieren(maerkte) {
  const gewaehlt = Array.isArray(maerkte) && maerkte.length ? maerkte : (store.maerkte || TEXT_MAERKTE.concat(PROSPEKT_MAERKTE));
  store.maerkte = gewaehlt;
  const links = await Promise.all(PROSPEKT_MAERKTE.filter(m => cfg.prospektSeiten[m]).map(async m => [m, await prospektLinkSuchen(m, cfg.prospektSeiten[m])]));
  const d = store.angebote || leererStand();
  d.prospektLinks = Object.fromEntries(links);
  d.quellen = (d.quellen || []).filter(q => !PROSPEKT_MAERKTE.includes(q.markt));
  for (const m of PROSPEKT_MAERKTE) if (gewaehlt.includes(m)) d.quellen.push({ markt: m, status: 'prospekt', anzahl: 0 });
  store.angebote = d;
  return d;
}

// Zeitplan: alle Märkte nacheinander, solange das Zeitbudget reicht
async function aktualisieren(maerkte) {
  await linksAktualisieren(maerkte);
  for (const m of TEXT_MAERKTE) {
    if (!store.maerkte.includes(m)) continue;
    if (Date.now() - START > 150000) break; // Rest holt die App beim nächsten Öffnen nach
    try { await marktAktualisieren(m); } catch (e) { /* nächster Markt */ }
  }
  return store.angebote;
}

async function flyerLesen(b) {
  if (!b.bild) throw new Error('Kein Bild übermittelt.');
  const bild = { type: 'image', source: { type: 'base64', media_type: b.mime || 'image/jpeg', data: b.bild } };
  const promptA = 'Das ist ein Werbeprospekt bzw. Handzettel (Markt: ' + (b.markt || 'unbekannt') + '). Lies alle Angebote aus.\n' + ANWEISUNG_ZEILEN;
  const promptB = 'Prüfe dieses Prospektfoto Preisschild für Preisschild. Lies jede Ziffer einzeln und sorgfältig, achte auf durchgestrichene Streichpreise (NICHT verwenden) und nimm nur den gültigen Angebotspreis.\n' + ANWEISUNG_ZEILEN;
  const [tA, tB] = await Promise.all([
    claude([bild, { type: 'text', text: promptA }], 8000),
    claude([bild, { type: 'text', text: promptB }], 8000)
  ]);
  const A = zeilenAngebote(tA), B = zeilenAngebote(tB);
  const genutztB = new Set();
  const ergebnis = [];
  for (const a of A) {
    const cent = preisZuCent(a.preisRoh);
    if (cent === null || cent <= 0) continue;
    const wa = stichwoerter(a.produkt);
    const idx = B.findIndex((x, i) => !genutztB.has(i) && preisZuCent(x.preisRoh) === cent && stichwoerter(x.produkt).some(w => wa.includes(w)));
    let sicherheit = 'unsicher', hinweis = 'Zweiter Lesedurchgang ergab einen anderen Preis';
    if (idx >= 0) { genutztB.add(idx); sicherheit = 'doppelt'; hinweis = ''; }
    const gp = grundpreisPruefung(cent, a.menge, a.grundpreis);
    if (gp === 'falsch') { sicherheit = 'unsicher'; hinweis = 'Grundpreis passt nicht zum Preis'; }
    ergebnis.push({ produkt: a.produkt, menge: a.menge, preis: cent / 100, grundpreis: a.grundpreis, gueltigVon: a.gueltigVon, gueltigBis: a.gueltigBis, sicherheit, grundpreisCheck: gp, hinweis });
  }
  B.forEach((x, i) => {
    if (genutztB.has(i)) return;
    const cent = preisZuCent(x.preisRoh);
    if (cent === null || cent <= 0) return;
    ergebnis.push({ produkt: x.produkt, menge: x.menge, preis: cent / 100, grundpreis: x.grundpreis, gueltigVon: x.gueltigVon, gueltigBis: x.gueltigBis, sicherheit: 'unsicher', grundpreisCheck: grundpreisPruefung(cent, x.menge, x.grundpreis), hinweis: 'Nur in einem Lesedurchgang gefunden' });
  });
  return { angebote: ergebnis };
}

async function vorratLesen(b) {
  if (!b.bild) throw new Error('Kein Bild übermittelt.');
  const t = await claude([
    { type: 'image', source: { type: 'base64', media_type: b.mime || 'image/jpeg', data: b.bild } },
    { type: 'text', text:
      'Auf dem Foto sind Lebensmittel. Heute ist ' + HEUTE + '. Erkenne jedes Lebensmittel und, falls sichtbar, das Mindesthaltbarkeits- oder Verbrauchsdatum.\n' +
      'Antworte NUR mit JSON: {"artikel":[{"name":"…","menge":"…","mhd":"JJJJ-MM-TT oder null","mhdSicher":true/false}]}\n' +
      '- mhd nur angeben, wenn du es auf dem Foto lesen kannst. Fehlt das Jahr, nimm das nächstliegende künftige Datum. Nicht raten – sonst null.\n' +
      '- mhdSicher=false, wenn Ziffern schlecht lesbar sind.\n- name kurz und deutsch (z. B. "Schlagsahne", "Frischkäse Kräuter").' }
  ], 3000);
  const j = jsonAus(t);
  return { artikel: (j.artikel || []).map(a => ({ name: a.name || '', menge: a.menge || '', mhd: /^\d{4}-\d{2}-\d{2}$/.test(a.mhd || '') ? a.mhd : '', mhdSicher: a.mhdSicher !== false })) };
}

async function rezepteErstellen(b) {
  const p = b.profil || {};
  const angebote = (b.angebote || []).slice(0, 250).map(a => a.id + ' | ' + a.markt + ' | ' + a.produkt + ' | ' + (a.menge || '') + ' | ' + (typeof a.preis === 'number' ? a.preis.toFixed(2).replace('.', ',') + ' €' : '')).join('\n');
  const vorrat = (b.vorrat || []).filter(v => v.tageBisMhd === null || v.tageBisMhd >= 0)
    .map(v => v.name + (v.menge ? ' (' + v.menge + ')' : '') + (v.tageBisMhd !== null ? ' – MHD in ' + v.tageBisMhd + ' Tagen' : '')).join('\n');
  const zeit = { schnell: 'maximal 20 Minuten Gesamtzeit', normal: 'maximal 45 Minuten Gesamtzeit', lang: 'darf auch aufwendig sein und länger dauern (Großfamilie, Festessen)' }[p.kochzeit] || 'maximal 45 Minuten';
  const prompt =
    'Du bist ein erfahrener Familienkoch in Deutschland. Erstelle ' + (b.anzahl || 3) + ' verschiedene Rezepte für: ' + (b.mahlzeit || 'Abendessen') + '.\n\n' +
    'HAUSHALT: ' + (p.erwachsene || 0) + ' Erwachsene (Appetit: ' + (p.appetitErwachsene || 'normal') + '), ' + (p.kinder || 0) + ' Kinder (Appetit: ' + (p.appetitKinder || 'normal') + '). Passe die Mengen genau daran an.\n' +
    'KÜCHENGERÄTE (nur diese verwenden): ' + ((p.geraete || []).join(', ') || 'Herd') + '. Wenn ein Thermomix vorhanden ist und es passt, Schritte mit Thermomix-Einstellungen (Zeit / Temperatur / Stufe) schreiben. Airfryer mit Temperatur und Zeit.\n' +
    'BIO: ' + ({ bio: 'möglichst Bio-Zutaten', normal: 'normale Ware', egal: 'egal' }[p.bio] || 'egal') + '\n' +
    'ERNÄHRUNG: ' + ((p.ernaehrung || []).join(', ') || 'keine Vorgabe') + '\n' +
    'SAISON: ' + (p.saison || '') + ' – bevorzuge saisonales Obst und Gemüse aus Deutschland.\n' +
    'KOCHZEIT: ' + zeit + '\n' +
    ((p.nichtVerwenden || []).length ? 'STRENG VERBOTEN (Abneigung/Allergie) – diese Lebensmittel dürfen in KEINER Form vorkommen, auch nicht als Bestandteil, Beilage, Garnitur oder in Saucen/Brühen/Gewürzmischungen; wähle andere Rezepte statt sie wegzulassen: ' + p.nichtVerwenden.join(', ') + '\n' : '') +
    (b.wunsch ? 'WUNSCH: ' + b.wunsch + '\n' : '') +
    '\nAKTUELLE ANGEBOTE (id | Markt | Produkt | Menge | Preis) – baue die Rezepte möglichst um diese Angebote herum:\n' + (angebote || '(keine)') + '\n' +
    '\nVORRAT – Zutaten mit baldigem MHD zuerst verbrauchen:\n' + (vorrat || '(leer)') + '\n' +
    '\nRegeln:\n- Wenn eine Zutat aus einem Angebot kommt, trage dessen id exakt in "angebotId" ein, sonst null.\n- Kommt sie aus dem Vorrat, setze "ausVorrat": true.\n- Grundzutaten (Salz, Pfeffer, Öl, Mehl, Zucker, Gewürze) als vorhanden annehmen.\n- Nährwerte pro Portion realistisch schätzen.\n' +
    '\nAntworte NUR mit JSON in genau diesem Format:\n' +
    '{"rezepte":[{"titel":"…","warum":"1 Satz, warum es passt (Angebote/Vorrat/Saison)","dauerMin":30,"portionen":"z. B. 2 Erw. + 2 Kinder","geraete":["…"],"bio":false,' +
    '"zutaten":[{"name":"…","menge":"…","angebotId":null,"ausVorrat":false}],"schritte":["…"],' +
    '"naehrwerte":{"kcal":0,"eiweiss":0,"fett":0,"kohlenhydrate":0},"kostenSchaetzung":"ca. … €"}]}';
  const t = await claude([{ type: 'text', text: prompt }], 12000);
  const j = jsonAus(t);
  const gueltigeIds = new Set((b.angebote || []).map(a => a.id));
  (j.rezepte || []).forEach(r => (r.zutaten || []).forEach(z => { if (z.angebotId && !gueltigeIds.has(z.angebotId)) z.angebotId = null; }));
  return { rezepte: j.rezepte || [] };
}

// ------------------------------------------------------------
// Ausführen
// ------------------------------------------------------------
let antwort;
try {
  if (aktion === 'ping') antwort = { ok: true, info: 'n8n Kochplaner läuft · KI: ' + (cfg.anbieter || 'gemini') + ' · Angebote-Stand: ' + ((store.angebote && store.angebote.stand) || 'noch keiner') };
  else if (aktion === 'angebote') antwort = store.angebote || { stand: null, quellen: [], angebote: [], prospektLinks: {} };
  else if (aktion === 'aktualisieren') antwort = await aktualisieren(body.maerkte);
  else if (aktion === 'links') antwort = await linksAktualisieren(body.maerkte);
  else if (aktion === 'markt') antwort = await marktAktualisieren(body.markt);
  else if (aktion === 'flyer') antwort = await flyerLesen(body);
  else if (aktion === 'vorrat') antwort = await vorratLesen(body);
  else if (aktion === 'rezepte') antwort = await rezepteErstellen(body);
  else antwort = { fehler: 'Unbekannte Aktion: ' + aktion };
} catch (e) {
  antwort = { fehler: String(e.message || e) };
}

// Beim Zeitplan gibt es niemanden, dem geantwortet wird
if (vomZeitplan) return [];
return [{ json: antwort }];
