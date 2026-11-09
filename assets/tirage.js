/* Tirage du jour et calcul des écarts. Fonctions pures, testables hors navigateur. */
(function (root) {
  'use strict';

  const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const isoDow = d => { const x = new Date(d + 'T12:00:00Z').getUTCDay(); return x === 0 ? 7 : x; };
  const lundi = d => addDays(d, 1 - isoDow(d));

  // Jour de comptage actif ? Par défaut lun-ven ; une ligne de calendrier peut forcer l'un ou l'autre.
  function jourActif(d, cal) {
    const r = cal && cal[d];
    if (r && r.actif !== null && r.actif !== undefined) return !!r.actif;
    return isoDow(d) <= 5;
  }

  // Unité de comptage d'un article de rotation, d'après sa famille et son unité Bizzon
  function uniteComptage(famille, unite) {
    if (/liter/.test(unite || '') && /BIERE/.test(famille || '')) return 'litres';
    if (/APERITIF|VIN|CHAMPAGNE|37\.5/.test(famille || '')) return 'bouteilles';
    return 'pieces';
  }

  function nomCourt(nom) {
    return String(nom).toLowerCase().replace(/\s+/g, ' ').trim().replace(/(^|[\s'(-])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase())
      .replace(/(\d+)\s?Cl\b/g, '$1 cl').replace(/(\d+)l\b/gi, '$1 L');
  }

  /**
   * Tirage des articles Bar du jour.
   * p.date, p.nBar (8), p.prioritaires [{nom_bizzon, freq_semaine}], p.comptesSemaine {nom: nb}, p.dernierComptage {nom: date},
   * p.joursActifsRestants (aujourd'hui compris, jusqu'à dimanche), p.recontrole [noms], p.salsa [noms],
   * p.rotation [{nom_bizzon, poids}], p.rng () => [0,1)
   * Renvoie [{nom_bizzon, motif}]
   */
  function tirerBar(p) {
    const out = [], pris = new Set();
    const add = (nom, motif) => { if (!pris.has(nom) && out.length < p.nBar) { pris.add(nom); out.push({ nom_bizzon: nom, motif }); } };
    (p.salsa || []).forEach(n => add(n, 'salsa'));
    (p.recontrole || []).forEach(n => add(n, 'recontrole'));
    const restants = Math.max(1, p.joursActifsRestants || 1);
    const prio = (p.prioritaires || []).map(a => {
      const reste = Math.max(0, (a.freq_semaine || 0) - ((p.comptesSemaine || {})[a.nom_bizzon] || 0));
      const hier = (p.dernierComptage || {})[a.nom_bizzon] === addDays(p.date, -1);
      return { nom: a.nom_bizzon, reste, urgence: reste / restants - (hier ? 0.5 : 0), alea: p.rng() };
    }).filter(a => a.reste > 0)
      .sort((a, b) => (b.urgence - a.urgence) || (a.alea - b.alea));
    // Obligatoires : ceux qui ne peuvent plus attendre (reste >= jours restants)
    prio.filter(a => a.reste >= restants).forEach(a => add(a.nom, 'prioritaire'));
    // Répartition : on vise (somme des restes) / jours restants articles prioritaires aujourd'hui
    const total = prio.reduce((s, a) => s + a.reste, 0);
    const cible = Math.min(p.nBar, Math.ceil(total / restants));
    for (const a of prio) { if (out.filter(o => o.motif === 'prioritaire').length >= cible) break; add(a.nom, 'prioritaire'); }
    // Rotation libre, tirage pondéré
    let pool = (p.rotation || []).filter(r => !pris.has(r.nom_bizzon));
    while (out.length < p.nBar && pool.length) {
      const tot = pool.reduce((s, r) => s + (r.poids || 1), 0);
      let x = p.rng() * tot, i = 0;
      for (; i < pool.length - 1; i++) { x -= (pool[i].poids || 1); if (x <= 0) break; }
      add(pool[i].nom_bizzon, 'rotation');
      pool.splice(i, 1);
    }
    // S'il manque encore des places : prioritaires restants
    for (const a of prio) add(a.nom, 'prioritaire');
    return out;
  }

  // Écart d'un article : compté − (théorique − pertes déclarées non reportées). Négatif = manque.
  function ecart(compte, theo, pertes, prix, unite, seuils) {
    if (theo === null || theo === undefined) return { e: null, ev: null, hors: false };
    const e = +(compte - (theo - (pertes || 0))).toFixed(3);
    const ev = prix ? +(e * prix).toFixed(2) : 0;
    const s = seuils || {};
    const sq = unite === 'litres' ? (s.litres ?? 5) : unite === 'bouteilles' ? (s.bouteilles ?? 0.2) : (s.pieces ?? 0);
    const hors = Math.abs(e) > sq + 1e-9 || Math.abs(ev) > (s.euros ?? 10) + 1e-9;
    return { e, ev, hors };
  }

  // Générateur pseudo-aléatoire reproductible (graine = date)
  function rngDepuis(graine) {
    let h = 2166136261;
    for (const c of String(graine)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
    return () => { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  const api = { addDays, isoDow, lundi, jourActif, uniteComptage, nomCourt, tirerBar, ecart, rngDepuis };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BarTirage = api;
})(typeof window !== 'undefined' ? window : globalThis);
