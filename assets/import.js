/* Lecture des exports Bizzon (Excel). Fonctions pures : testables hors navigateur. */
(function (root) {
  'use strict';

  // Certains exports Bizzon déclarent une zone trop petite : on la recalcule à partir des cellules réelles.
  function fixRange(XLSX, ws) {
    let mr = 0, mc = 0;
    for (const k of Object.keys(ws)) {
      if (k[0] === '!') continue;
      const c = XLSX.utils.decode_cell(k);
      if (c.r > mr) mr = c.r;
      if (c.c > mc) mc = c.c;
    }
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: mr, c: mc } });
    return ws;
  }

  function rows(XLSX, ws) {
    fixRange(XLSX, ws);
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  }

  const num = v => (v === null || v === undefined || v === '') ? null : (typeof v === 'number' ? v : Number(String(v).replace(',', '.')));

  function detectType(wb) {
    if (wb.SheetNames.includes('ECONOMAT GENERAL')) return 'stock';
    if (wb.SheetNames.some(n => /analyse des ventes/i.test(n))) return 'ventes';
    return null;
  }

  // "Exporté à: 07/11/2026 12:30" -> Date (heure de Paris)
  function parseExportDate(txt) {
    const m = /(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})/.exec(txt || '');
    if (!m) return null;
    return { iso: `${m[3]}-${m[2]}-${m[1]}T${m[4].padStart(2, '0')}:${m[5]}:00`, affichage: `${m[1]}/${m[2]}/${m[3]} ${m[4]}h${m[5]}` };
  }

  // "StockThéorique_20261101-20261108.xlsx" -> période
  function parsePeriode(nom) {
    const m = /(\d{8})-(\d{8})/.exec(nom || '');
    if (!m) return { debut: null, fin: null };
    const f = s => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    return { debut: f(m[1]), fin: f(m[2]) };
  }

  function parseStock(XLSX, wb, fichier) {
    const ws = wb.Sheets['ECONOMAT GENERAL'];
    if (!ws) throw new Error("Ce fichier n'a pas d'onglet ECONOMAT GENERAL : ce n'est pas un export Stock théorique.");
    const a = rows(XLSX, ws);
    const hi = a.findIndex(r => r && r[0] === 'Produit' && r.includes('Prévu'));
    if (hi < 0) throw new Error("Colonnes introuvables dans l'onglet ECONOMAT GENERAL. Le format de l'export a peut-être changé.");
    const h = a[hi];
    const col = name => h.findIndex(x => x && String(x).startsWith(name));
    const C = { nom: 0, sku: col('SKU'), unite: col('Unité'), qi: col('Quantité initiale'), recu: col('Reçu'), vendu: col('Vendu'),
      tr: col('Transferts'), aj: col('Ajustements'), prevu: col('Prévu'), prix: col('Prix unitaire'), valeur: col('Valeur prévue') };
    const lignes = [];
    let famille = null;
    for (let i = hi + 1; i < a.length; i++) {
      const r = a[i];
      if (!r || r[0] === null || r[0] === '') continue;
      const nom = String(r[0]).trim();
      if (nom === 'Produit') continue;
      if (/^Total /.test(nom)) continue;
      if (r[C.unite] === null || r[C.unite] === undefined) { // ligne de famille ou de sous-famille
        famille = nom;
        continue;
      }
      lignes.push({
        nom_bizzon: nom,
        code_ac: r[C.sku] ? String(r[C.sku]).trim() : null,
        unite: String(r[C.unite]).trim(),
        famille,
        qte_initiale: num(r[C.qi]), recu: num(r[C.recu]), vendu: num(r[C.vendu]),
        transferts: num(r[C.tr]), ajustements: num(r[C.aj]),
        prevu: num(r[C.prevu]), prix: num(r[C.prix]), valeur: num(r[C.valeur])
      });
    }
    // Heure d'export : dans l'onglet récapitulatif
    let exporte = null;
    for (const n of wb.SheetNames) {
      const found = rows(XLSX, wb.Sheets[n]).flat().find(x => /Export[ée] à/.test(String(x)));
      if (found) { exporte = parseExportDate(String(found)); break; }
    }
    const per = parsePeriode(fichier);
    return { type: 'stock', exporte, periode: per, lignes };
  }

  function parseVentes(XLSX, wb, fichier) {
    const name = wb.SheetNames.find(n => /analyse des ventes/i.test(n)) || wb.SheetNames[0];
    const a = rows(XLSX, wb.Sheets[name]);
    const hi = a.findIndex(r => r && r.includes('Point de vente') && r.includes("Nom de l'article"));
    if (hi < 0) throw new Error("Colonnes introuvables : ce fichier ne ressemble pas à une Analyse des ventes Bizzon.");
    const h = a[hi];
    const c = n => h.indexOf(n);
    const C = { date: c('Date'), art: c("Nom de l'article"), grp: c('Groupe de famille'), fam: c('Famille'), sf: c('Sous-famille'),
      centre: c('Centre de revenus'), pv: c('Point de vente'), q: c('Quantité vendue'), brut: c('Ventes brutes H.T.'), rem: c('Remises'), net: c('Ventes Nettes H.T.') };
    const lignes = [];
    for (let i = 0; i < a.length; i++) {
      const r = a[i];
      if (i === hi || !r || typeof num(r[C.q]) !== 'number' || isNaN(num(r[C.q])) || !r[C.art] || !r[C.pv]) continue;
      let d = r[C.date];
      if (d instanceof Date) d = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; // date locale : toISOString décalerait d'un jour à Paris
      else if (typeof d === 'number') d = new Date(Math.round((d - 25569) * 864e5)).toISOString().slice(0, 10);
      else if (typeof d === 'string') { const m = /(\d{4})-(\d{2})-(\d{2})/.exec(d) || /(\d{2})\/(\d{2})\/(\d{4})/.exec(d); d = m ? (m[1].length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}-${m[2]}-${m[1]}`) : null; }
      if (!d) continue;
      lignes.push({ date_vente: d, article: String(r[C.art]).trim(), groupe: r[C.grp], famille: r[C.fam], sous_famille: r[C.sf],
        centre: r[C.centre], point_vente: r[C.pv], quantite: num(r[C.q]), brut_ht: num(r[C.brut]), remises: num(r[C.rem]), net_ht: num(r[C.net]) });
    }
    if (!lignes.length) throw new Error('Aucune ligne de vente trouvée dans ce fichier.');
    const dates = [...new Set(lignes.map(l => l.date_vente))].sort();
    // Un fichier = une journée Bizzon. Une soirée qui finit après minuit fait apparaître des lignes datées du lendemain :
    // elles appartiennent à la même journée. Au-delà, Bizzon cumule chaque article sur la période et les chiffres par jour seraient faux.
    const per = parsePeriode(fichier);
    const addDay = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
    const jour = per.debut || dates[0];
    const ecartFichier = per.debut && per.fin ? Math.round((Date.parse(per.fin) - Date.parse(per.debut)) / 864e5) : 0;
    const horsJour = dates.filter(d => d !== jour && d !== addDay(jour, 1));
    if (ecartFichier > 1 || horsJour.length) {
      throw new Error("Cet export couvre plusieurs journées. Sur plusieurs jours, Bizzon additionne chaque article sans le répartir par jour, donc les chiffres seraient faux. Exporte une journée à la fois (date de début = le jour voulu, date de fin = le lendemain).");
    }
    for (const l of lignes) l.date_vente = jour;   // ventes d'après minuit rattachées à la journée
    return { type: 'ventes', periode: { debut: jour, fin: jour }, lignes };
  }

  // Synthèse des ventes d'une journée : par point de vente, hors exclusions (petit-déjeuner, banquet)
  function syntheseVentes(lignes, excl) {
    const exC = new Set((excl && excl.centres) || []), exP = new Set((excl && excl.points_vente) || []);
    const garde = lignes.filter(l => !exC.has(l.centre) && !exP.has(l.point_vente));
    const exclu = lignes.filter(l => exC.has(l.centre) || exP.has(l.point_vente));
    const parPV = {};
    for (const l of garde) {
      const p = parPV[l.point_vente] || (parPV[l.point_vente] = { total: 0, centres: {}, articles: {} });
      p.total += l.net_ht || 0;
      p.centres[l.centre] = (p.centres[l.centre] || 0) + (l.net_ht || 0);
      const a = p.articles[l.article] || (p.articles[l.article] = { q: 0, net: 0 });
      a.q += l.quantite || 0; a.net += l.net_ht || 0;
    }
    const horsPerimetre = {};
    for (const l of exclu) {
      const k = exC.has(l.centre) ? l.centre : l.point_vente;
      horsPerimetre[k] = (horsPerimetre[k] || 0) + (l.net_ht || 0);
    }
    return { parPV, horsPerimetre };
  }

  const api = { detectType, parseStock, parseVentes, syntheseVentes, parseExportDate, parsePeriode };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BarImport = api;
})(typeof window !== 'undefined' ? window : globalThis);
