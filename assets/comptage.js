/* Outil Bar 1.13 — étape 2 : tirage du jour, comptage sur téléphone, écarts, calendrier */
(function () {
  'use strict';
  const T = window.BarTirage;
  const C = () => window.BarCtx;
  const U = { litres: 'L', bouteilles: 'btl', pieces: 'pc' };
  const COLS = { eco: 'Économat', bar: 'Bar', ms: 'Mshop' };
  const CAUSES = ['Erreur de comptage', 'Surdosage', 'Perte non déclarée', 'Mauvais article encaissé', 'Vente non reliée au stock', 'Réception non saisie', 'Offert non saisi', 'Vol suspecté', 'Autre', 'Inconnue'];
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  /* ================= Données communes ================= */
  async function reglages() {
    const { data } = await C().sb.from('bar_reglages').select('*');
    return Object.fromEntries((data || []).map(r => [r.cle, r.valeur]));
  }
  async function calendrier(from, to) {
    const { data } = await C().sb.from('bar_calendrier').select('*').gte('date_jour', from).lte('date_jour', to);
    return Object.fromEntries((data || []).map(r => [r.date_jour, r]));
  }
  // Dernier stock théorique importé le jour donné (heure de Paris)
  async function stockDuJour(date) {
    const { sb, TZ } = C();
    const { data } = await sb.from('bar_imports').select('*').eq('type', 'stock').order('exporte_le', { ascending: false }).limit(10);
    return (data || []).find(i => new Date(i.exporte_le).toLocaleDateString('en-CA', { timeZone: TZ }) === date) || null;
  }
  async function theoriques(importId, noms) {
    if (!importId || !noms.length) return {};
    const { data } = await C().sb.from('bar_stock_theo').select('nom_bizzon,prevu,prix,unite').eq('import_id', importId).in('nom_bizzon', noms);
    return Object.fromEntries((data || []).map(l => [l.nom_bizzon, l]));
  }
  // Pertes validées pas encore reportées dans Bizzon, déclarées avant l'instant donné
  async function pertesEnCours(noms, avant) {
    if (!noms.length) return {};
    const { data } = await C().sb.from('bar_pertes').select('nom_bizzon,quantite,cree_le').eq('statut', 'validee').is('reporte_bizzon', null).in('nom_bizzon', noms);
    const out = {};
    for (const p of data || []) if (!avant || p.cree_le <= avant) out[p.nom_bizzon] = (out[p.nom_bizzon] || 0) + Number(p.quantite);
    return out;
  }

  /* ================= Tirage du jour ================= */
  async function lireTirage(date) {
    const { data } = await C().sb.from('bar_tirages').select('motif, article:bar_articles(*)').eq('date_jour', date);
    return (data || []).filter(t => t.article).map(t => ({ ...t.article, motif: t.motif }))
      .sort((a, b) => (a.type === 'canette') - (b.type === 'canette') || a.ordre - b.ordre || a.nom_court.localeCompare(b.nom_court));
  }

  async function assurerTirage(date, forcer) {
    const { sb } = C();
    let { data: cpt } = await sb.from('bar_comptages').select('*').eq('date_jour', date).maybeSingle();
    if (cpt && cpt.tirage_ok) return { comptage: cpt, articles: await lireTirage(date) };
    if (!cpt) {
      const cal = await calendrier(date, date);
      if (!forcer && !T.jourActif(date, cal)) return { inactif: true };
      const { data: ins } = await sb.from('bar_comptages').upsert({ date_jour: date, par: C().user().id }, { onConflict: 'date_jour', ignoreDuplicates: true }).select();
      if (!ins || !ins.length) { // quelqu'un d'autre fait le tirage en même temps : on attend
        for (let k = 0; k < 10; k++) { await new Promise(r => setTimeout(r, 800)); const { data: c2 } = await sb.from('bar_comptages').select('*').eq('date_jour', date).maybeSingle(); if (c2 && c2.tirage_ok) return { comptage: c2, articles: await lireTirage(date) }; }
        throw new Error('Le tirage du jour ne répond pas. Recharge la page.');
      }
      cpt = ins[0];
    }
    await calculerTirage(date, cpt);
    const { data: c3 } = await sb.from('bar_comptages').update({ tirage_ok: true }).eq('id', cpt.id).select().single();
    return { comptage: c3, articles: await lireTirage(date) };
  }

  async function calculerTirage(date, cpt) {
    const { sb } = C();
    const R = await reglages();
    const lun = T.lundi(date), dim = T.addDays(lun, 6);
    const cal = await calendrier(T.addDays(date, -10), dim);
    const { data: arts } = await sb.from('bar_articles').select('*').eq('actif', true);
    const byNom = Object.fromEntries((arts || []).map(a => [a.nom_bizzon, a]));
    const prio = (arts || []).filter(a => a.type === 'prioritaire');
    const cans = (arts || []).filter(a => a.type === 'canette');
    // Comptages de la semaine
    const { data: sem } = await sb.from('bar_tirages').select('date_jour, article:bar_articles(nom_bizzon)').gte('date_jour', lun).lt('date_jour', date);
    const comptes = {}, dernier = {};
    for (const t of sem || []) if (t.article) { const n = t.article.nom_bizzon; comptes[n] = (comptes[n] || 0) + 1; if (!dernier[n] || dernier[n] < t.date_jour) dernier[n] = t.date_jour; }
    let restants = 0; for (let d = date; d <= dim; d = T.addDays(d, 1)) if (T.jourActif(d, cal)) restants++;
    // Recontrôle : écarts restés hors seuil au dernier comptage
    const { data: prev } = await sb.from('bar_comptages').select('id,date_jour').lt('date_jour', date).not('valide_le', 'is', null).order('date_jour', { ascending: false }).limit(1);
    let recontrole = [];
    if (prev && prev[0]) { const rows = await calculerEcarts(prev[0].id); recontrole = rows.filter(r => r.hors && r.article.type !== 'canette').map(r => r.article.nom_bizzon); }
    // Soirée salsa depuis le dernier jour de comptage
    let precedent = T.addDays(date, -1); for (let k = 0; k < 7 && !T.jourActif(precedent, cal); k++) precedent = T.addDays(precedent, -1);
    let salsa = [];
    for (let d = precedent; d < date; d = T.addDays(d, 1)) if (cal[d] && cal[d].salsa) salsa = R.salsa_articles || [];
    // Rotation libre : familles du bar, vendu dans les 30 derniers jours
    const exclus = new Set([...prio, ...cans].map(a => a.nom_bizzon).concat(salsa));
    const fam = new Set(R.rotation_familles || []);
    // Dernier stock théorique importé (« Vendu » y est cumulé depuis le dernier inventaire Bizzon)
    const { data: imps } = await sb.from('bar_imports').select('id').eq('type', 'stock').order('exporte_le', { ascending: false }).limit(1);
    let lignes = [];
    if (imps && imps[0]) { const { data } = await sb.from('bar_stock_theo').select('nom_bizzon,famille,unite,prevu,vendu').eq('import_id', imps[0].id).in('famille', [...fam]); lignes = data || []; }
    const ok = l => fam.has(l.famille) && /^1\.000 /.test(l.unite || '') && !exclus.has(l.nom_bizzon);
    let pool = lignes.filter(l => ok(l) && Number(l.vendu) > 0);
    if (pool.length < 15) pool = lignes.filter(l => ok(l) && (Number(l.vendu) > 0 || Number(l.prevu) > 0)); // peu de ventes : articles en stock
    const rotation = pool.map(l => ({ nom_bizzon: l.nom_bizzon, poids: recontrole.includes(l.nom_bizzon) ? 4 : 1, l }));
    const choix = T.tirerBar({ date, nBar: 8, prioritaires: prio, comptesSemaine: comptes, dernierComptage: dernier, joursActifsRestants: restants,
      recontrole, salsa, rotation, rng: T.rngDepuis(date) });
    // Articles de rotation ou de salsa pas encore connus : on les crée
    const infos = Object.fromEntries(lignes.map(l => [l.nom_bizzon, l]));
    const nouveaux = choix.filter(c => !byNom[c.nom_bizzon]).map(c => { const l = infos[c.nom_bizzon] || {};
      return { nom_bizzon: c.nom_bizzon, nom_court: T.nomCourt(c.nom_bizzon), unite: T.uniteComptage(l.famille || 'APERITIF', l.unite || ''), type: 'rotation', freq_semaine: 0, emplacements: ['eco', 'bar'], ordre: 100 }; });
    if (nouveaux.length) {
      await sb.from('bar_articles').upsert(nouveaux, { onConflict: 'nom_bizzon', ignoreDuplicates: true });
      const { data: re } = await sb.from('bar_articles').select('*').in('nom_bizzon', nouveaux.map(n => n.nom_bizzon));
      (re || []).forEach(a => byNom[a.nom_bizzon] = a);
    }
    const rows = choix.filter(c => byNom[c.nom_bizzon]).map(c => ({ date_jour: date, article_id: byNom[c.nom_bizzon].id, motif: c.motif === 'salsa' ? 'manuel' : c.motif }))
      .concat(cans.map(a => ({ date_jour: date, article_id: a.id, motif: 'canette' })));
    const { error } = await sb.from('bar_tirages').upsert(rows, { onConflict: 'date_jour,article_id', ignoreDuplicates: true });
    if (error) throw new Error('Tirage non enregistré : ' + error.message);
  }

  /* ================= Écarts ================= */
  async function calculerEcarts(comptageId) {
    const { sb } = C();
    const { data: cpt } = await sb.from('bar_comptages').select('*').eq('id', comptageId).single();
    const arts = await lireTirage(cpt.date_jour);
    const { data: lignes } = await sb.from('bar_comptage_lignes').select('*').eq('comptage_id', comptageId);
    const R = await reglages();
    let imp = cpt.import_stock_id ? { id: cpt.import_stock_id } : await stockDuJour(cpt.date_jour);
    const noms = arts.map(a => a.nom_bizzon);
    const th = imp ? await theoriques(imp.id, noms) : {};
    const pertes = await pertesEnCours(noms, cpt.valide_le);
    const { data: causes } = await sb.from('bar_causes').select('*').eq('comptage_id', comptageId);
    const causeBy = Object.fromEntries((causes || []).map(c => [c.article_id, c]));
    return arts.map(a => {
      const mine = (lignes || []).filter(l => l.article_id === a.id);
      const rc = mine.some(l => l.recompte);
      const use = rc ? mine.filter(l => l.recompte) : mine.filter(l => !l.recompte);
      const qte = {}; use.forEach(l => qte[l.emplacement] = Number(l.quantite));
      const complet = a.emplacements.every(e => qte[e] !== undefined);
      const total = a.emplacements.reduce((s, e) => s + (qte[e] || 0), 0);
      const t = th[a.nom_bizzon];
      const r = complet && t ? T.ecart(total, Number(t.prevu), pertes[a.nom_bizzon] || 0, Number(t.prix), a.unite, R.seuils, a.type) : { e: null, ev: null, hors: false };
      let statut = !complet ? 'Non compté' : !t ? 'Théorique absent' : r.hors ? (rc ? 'Écart confirmé' : 'À recontrôler') : (rc ? 'Conforme après recompte' : 'Conforme');
      return { article: a, qte, total, complet, theo: t ? Number(t.prevu) : null, prix: t ? Number(t.prix) : null, pertes: pertes[a.nom_bizzon] || 0, ...r, rc, statut, cause: causeBy[a.id] };
    });
  }

  /* ================= Téléphone : comptage ================= */
  let P = null; // état de l'écran
  async function phone(app) {
    const { todayParis } = C();
    const date = todayParis();
    app.innerHTML = `<div class="ph"><div class="center"><div class="hint">Préparation du comptage…</div></div></div>`;
    let res;
    try { res = await assurerTirage(date, P && P.forcer); } catch (e) { app.innerHTML = `<div class="center"><div><h2>Erreur</h2><p class="hint">${C().esc(e.message)}</p></div></div>`; return; }
    if (res.inactif) {
      app.innerHTML = `<div class="ph">${phHead(date, null)}<div class="ph-body"><div class="card" style="text-align:center;align-items:center"><h3>Pas de comptage prévu aujourd'hui</h3><p class="hint" style="margin:0">Le calendrier ne prévoit pas de comptage ce jour-là (week-end ou jour sauté).</p><button class="btn brass" id="force">Compter quand même</button></div>${phFoot()}</div></div>`;
      document.getElementById('force').onclick = () => { P = { forcer: true }; phone(app); };
      bindFoot(app); return;
    }
    const { data: lignes } = await C().sb.from('bar_comptage_lignes').select('*').eq('comptage_id', res.comptage.id);
    const vals = {}, rvals = {};
    res.articles.forEach(a => { vals[a.id] = {}; rvals[a.id] = {}; });
    (lignes || []).forEach(l => { (l.recompte ? rvals : vals)[l.article_id] && ((l.recompte ? rvals : vals)[l.article_id][l.emplacement] = String(l.quantite)); });
    P = { app, date, comptage: res.comptage, articles: res.articles, vals, rvals, cur: null, buf: '', kegN: 0, kegT: false, pending: new Map(), flushing: null, retry: null,
      phase: res.comptage.valide_le ? 'done' : (res.comptage.recompte_ids && res.comptage.recompte_ids.length ? 'recount' : 'count') };
    P.stock = await stockDuJour(date);
    drawPhone();
  }

  function phHead(date, ratio) {
    const { fmtD, roleName } = C();
    const r = 22, c = 2 * Math.PI * r;
    return `<div class="ph-top"><div class="hello"><div><small>${cap(fmtD(date))}</small><h2>Bonjour ${C().esc(roleName() || '')}</h2></div>
      ${ratio === null ? '' : `<svg class="ring" viewBox="0 0 54 54" aria-label="${Math.round(ratio * 100)} % saisi"><circle class="bgc" cx="27" cy="27" r="${r}"/><circle class="fgc" cx="27" cy="27" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - ratio)}" transform="rotate(-90 27 27)"/><text x="27" y="31" text-anchor="middle">${Math.round(ratio * 100)}%</text></svg>`}</div></div>`;
  }
  function phFoot() { return `<div class="ph-links"><button class="btn ghost sm" id="toPoste">Ouvrir la version ordinateur</button><button class="btn ghost sm" id="phOut">Déconnexion</button></div>`; }
  function bindFoot() {
    const a = document.getElementById('toPoste'); if (a) a.onclick = () => C().poste();
    const b = document.getElementById('phOut'); if (b) b.onclick = () => C().logout();
  }

  const cellsOf = a => P.phase === 'recount' && P.comptage.recompte_ids.includes(a.id) ? P.rvals[a.id] : P.vals[a.id];
  function remplies() { let f = 0, t = 0; P.articles.forEach(a => { if (P.phase === 'recount' && !P.comptage.recompte_ids.includes(a.id)) return; a.emplacements.forEach(e => { t++; if ((cellsOf(a)[e] ?? '') !== '') f++; }); }); return [f, t]; }
  const num = v => parseFloat(String(v).replace(',', '.')) || 0;
  const totalOf = a => a.emplacements.reduce((s, e) => s + num(cellsOf(a)[e] ?? 0), 0);
  const fmtV = v => v === undefined || v === '' ? '–' : String(v).replace('.', ',');

  function drawPhone() {
    const { esc, fr, fmtDT } = C();
    const app = P.app;
    if (P.phase === 'done') {
      const nrc = (P.comptage.recompte_ids || []).length;
      app.innerHTML = `<div class="ph">${phHead(P.date, 1)}<div class="ph-body"><div class="card done-card"><div class="big">✓</div><h2>Comptage validé</h2>
        <p class="hint" style="margin:0">Validé le ${fmtDT(P.comptage.valide_le)} · ${P.articles.length} articles${nrc ? ` · ${nrc} recompté${nrc > 1 ? 's' : ''} sur place` : ''}. Les écarts sont sur l'ordinateur, menu « Écarts ».</p>
        <button class="btn ghost" id="reopen">Corriger une saisie</button></div>${phFoot()}</div></div>`;
      document.getElementById('reopen').onclick = async () => { await C().sb.from('bar_comptages').update({ valide_le: null }).eq('id', P.comptage.id); P.comptage.valide_le = null; P.phase = P.comptage.recompte_ids.length ? 'recount' : 'count'; drawPhone(); };
      bindFoot(); return;
    }
    const [f, t] = remplies();
    const bar = P.articles.filter(a => a.type !== 'canette'), cans = P.articles.filter(a => a.type === 'canette');
    const row = a => {
      const rec = P.phase === 'recount' && P.comptage.recompte_ids.includes(a.id), lock = P.phase === 'recount' && !rec;
      const v = cellsOf(a), open = P.cur && P.cur.a === a.id;
      const done = a.emplacements.every(e => (v[e] ?? '') !== '');
      return `<tr class="${rec ? 'recount' : ''} ${lock ? 'locked ok' : ''} ${open ? 'has-kp' : ''}"><td><div class="nm">${esc(a.nom_court)}</div><div class="un">${rec ? '<span class="flag">Recompte</span>' : a.motif === 'recontrole' ? '<span class="flag">Recontrôle</span>' : U[a.unite]}</div></td>
        ${['eco', 'bar', 'ms'].map(e => a.emplacements.includes(e) ? `<td><button class="cell ${(v[e] ?? '') === '' ? 'empty' : ''} ${open && P.cur.e === e ? 'cur' : ''}" data-a="${a.id}" data-e="${e}" ${lock ? 'disabled' : ''} aria-label="${esc(a.nom_court)}, ${COLS[e]}">${fmtV(v[e])}</button></td>` : '<td><span class="na" aria-hidden="true">·</span></td>').join('')}
        <td class="tot">${done ? fr(totalOf(a), 2) : '–'}</td></tr>${open ? `<tr class="kprow"><td colspan="5">${keypad(a)}</td></tr>` : ''}`;
    };
    const table = (list, titre, sous) => `<div><div class="sec-h"><h3>${titre}</h3><span>${sous}</span></div><table class="ctab"><thead><tr><th>Article</th><th>Éco.</th><th>Bar</th><th>Mshop</th><th>Total</th></tr></thead><tbody>${list.map(row).join('')}</tbody></table></div>`;
    app.innerHTML = `<div class="ph">${phHead(P.date, t ? f / t : 0)}
      <div class="ph-top ph-status"><div class="status ${P.stock ? '' : 'missing'}">${P.stock ? `Stock théorique du jour importé (${fmtDT(P.stock.exporte_le)}) : recompte immédiat actif` : 'Stock du jour pas encore importé : pas de recompte immédiat, les écarts seront calculés après l’import'}</div></div>
      <div class="ph-body">
      <div class="status-warn" id="unsaved" hidden></div>
      ${P.phase === 'recount' ? `<div class="status-warn">${P.comptage.recompte_ids.length} article${P.comptage.recompte_ids.length > 1 ? 's' : ''} à recompter. Recompte les lignes surlignées, sans regarder les autres.</div>` : ''}
      ${table(bar, `Bar · ${bar.length} articles du jour`, 'tirage du jour')}
      ${table(cans, 'Canettes · tous les jours', 'liste fixe')}
      <p class="hint" style="margin:0 4px">Touche une case : le pavé s'ouvre dessous, « Suivant » descend dans la colonne. Toute la réserve, puis le bar, puis le Mshop. Un emplacement vide se saisit 0.</p>
      <div class="ph-foot"><button class="btn brass" id="valider" ${f < t ? 'disabled' : ''}>${f < t ? `Encore ${t - f} case${t - f > 1 ? 's' : ''} à remplir` : P.phase === 'recount' ? 'Valider le recompte' : 'Valider le comptage'}</button></div>
      ${phFoot()}</div></div>`;
    app.querySelectorAll('.cell[data-a]').forEach(b => b.onclick = () => { if (P.cur) commit(); P.cur = { a: +b.dataset.a, e: b.dataset.e }; P.buf = ''; P.kegN = 0; P.kegT = false; P.chip = false; drawPhone(); scrollKp(); });
    if (P.cur) bindKeypad();
    document.getElementById('valider').onclick = valider;
    majNonEnregistre();
    bindFoot();
  }

  const tailleFut = a => { const m = /(\d+)\s?L\b/i.exec(a.nom_bizzon); return m ? +m[1] : 20; };
  function keypad(a) {
    const keg = a.unite === 'litres', btl = a.unite === 'bouteilles', tf = tailleFut(a);
    const stored = cellsOf(a)[P.cur.e];
    let v = P.buf !== '' ? P.buf : fmtV(stored) === '–' ? '' : fmtV(stored);
    const partiel = num(P.buf);
    if (keg && P.kegT) v = C().fr(P.kegN * tf + partiel);
    if (keg) return `<div class="kp" role="dialog" aria-label="Saisie ${C().esc(a.nom_court)}"><div class="kp-h"><div><small>${COLS[P.cur.e]} · litres</small><b>${C().esc(a.nom_court)}</b></div><button class="kp-x" data-kp="close">Fermer</button></div>
      <div class="kp-disp">${v === '' ? '–' : v}<span>L</span></div>
      <div class="kp-help">${P.kegT ? `${P.kegN} × ${tf} L + ${C().fr(partiel)} L entamé` : stored !== undefined && stored !== '' ? 'Déjà saisi. Touche un bouton pour recommencer.' : 'Deux étapes : les fûts pleins, puis les litres du fût entamé.'}</div>
      <div class="kp-zone"><span>1 · Fûts pleins</span><div class="kp-step"><button data-kp="keg-" aria-label="Un fût plein de moins">−</button><b>${P.kegT ? P.kegN : 0}</b><button data-kp="keg+" aria-label="Un fût plein de plus">+</button></div></div>
      <div class="kp-zone"><span>2 · Fût entamé (litres)</span><div class="kp-quick kp-q4">${[0, 5, 10, 15].filter(x => x < tf).map(x => `<button data-kp="p${x}" class="${P.kegT && P.buf === String(x) ? 'on' : ''}">${x} L</button>`).join('')}</div></div>
      <div class="kp-keys">${['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', '⌫'].map(k => `<button data-kp="k${k}">${k}</button>`).join('')}</div>
      <button class="kp-next" data-kp="next">Suivant ›</button></div>`;
    return `<div class="kp" role="dialog" aria-label="Saisie ${C().esc(a.nom_court)}"><div class="kp-h"><div><small>${COLS[P.cur.e]} · ${a.unite}</small><b>${C().esc(a.nom_court)}</b></div><button class="kp-x" data-kp="close">Fermer</button></div>
      <div class="kp-disp">${v === '' ? '–' : v}<span>${U[a.unite]}</span></div>
      <div class="kp-help">${keg ? (P.kegT ? `${P.kegN} fût${P.kegN > 1 ? 's' : ''} plein${P.kegN > 1 ? 's' : ''} + ${C().fr(partiel)} L dans le fût entamé` : 'Ajoute les fûts pleins, puis tape les litres du fût entamé') : btl ? 'Bouteille entamée : touche le dixième' : ''}</div>
      ${btl ? `<div class="kp-quick">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map(d => `<button data-kp="t${d}">,${d}</button>`).join('')}</div>` : ''}
      <div class="kp-keys">${['1', '2', '3', '4', '5', '6', '7', '8', '9', btl || keg ? ',' : '', '0', '⌫'].map(k => k ? `<button data-kp="k${k}">${k}</button>` : '<span></span>').join('')}</div>
      <button class="kp-next" data-kp="next">Suivant ›</button></div>`;
  }

  function ordre() {
    const out = [];
    ['eco', 'bar', 'ms'].forEach(e => P.articles.forEach(a => { if (a.emplacements.includes(e) && !(P.phase === 'recount' && !P.comptage.recompte_ids.includes(a.id))) out.push({ a: a.id, e }); }));
    return out;
  }
  const curArt = () => P.articles.find(x => x.id === P.cur.a);

  /* Saisie : mise à jour locale immédiate, enregistrement en file d'attente avec reprise (réseau faible à l'économat) */
  function commit() {
    const a = curArt(); if (!a) return;
    let val = null;
    if (a.unite === 'litres' && P.kegT) val = P.kegN * tailleFut(a) + num(P.buf);
    else if (P.buf !== '') val = num(P.buf);
    P.buf = ''; P.kegN = 0; P.kegT = false; P.chip = false;
    if (val === null) return;
    const rec = P.phase === 'recount';
    cellsOf(a)[P.cur.e] = String(val);
    const key = [a.id, P.cur.e, rec].join('|');
    P.pending.set(key, { comptage_id: P.comptage.id, article_id: a.id, emplacement: P.cur.e, quantite: val, recompte: rec, saisi_le: new Date().toISOString() });
    flush();
  }
  async function flush() {
    if (P.flushing) return P.flushing;
    if (!P.pending.size) { majNonEnregistre(); return; }
    P.flushing = (async () => {
      await null; // l'affectation de P.flushing doit précéder la fin de la boucle
      let essais = 0;
      while (P.pending.size && essais < 4) {
        const rows = [...P.pending.entries()];
        let error = null;
        try { ({ error } = await C().sb.from('bar_comptage_lignes').upsert(rows.map(r => r[1]), { onConflict: 'comptage_id,article_id,emplacement,recompte' })); }
        catch (e) { error = e; }
        if (error) console.warn('Enregistrement en attente', error);
        if (!error) { rows.forEach(([k, r]) => { if (P.pending.get(k) === r) P.pending.delete(k); }); essais = 0; }
        else { essais++; await new Promise(r => setTimeout(r, 700 * essais)); }
      }
      P.flushing = null;
      majNonEnregistre();
      if (P.pending.size && !P.retry) P.retry = setTimeout(() => { P.retry = null; flush(); }, 5000);
    })();
    return P.flushing;
  }
  function majNonEnregistre() {
    const el = document.getElementById('unsaved'); if (!el) return;
    el.hidden = !P.pending.size;
    el.textContent = `${P.pending.size} saisie${P.pending.size > 1 ? 's' : ''} en attente de réseau. Elles partent dès que la connexion revient.`;
    P.app.querySelectorAll('.cell[data-a]').forEach(b => b.classList.toggle('unsaved', [...P.pending.values()].some(r => r.article_id === +b.dataset.a && r.emplacement === b.dataset.e)));
  }

  function bindKeypad() {
    P.app.querySelectorAll('[data-kp]').forEach(b => b.onclick = async () => {
      const k = b.dataset.kp, a = curArt();
      if (k === 'close') { commit(); P.cur = null; drawPhone(); return; }
      if (k === 'next') {
        if (P.buf === '' && !P.kegT && (cellsOf(a)[P.cur.e] ?? '') === '') P.buf = '0';
        commit();
        const o = ordre(), i = o.findIndex(x => x.a === P.cur.a && x.e === P.cur.e);
        P.cur = o[i + 1] || null; drawPhone(); if (P.cur) scrollKp(); else C().toast('Dernière case remplie');
        return;
      }
      if (k === 'keg+' || k === 'keg-') { P.kegT = true; P.kegN = Math.max(0, P.kegN + (k === 'keg+' ? 1 : -1)); }
      else if (k[0] === 'p') { P.kegT = true; P.buf = k.slice(1); P.chip = true; }
      else if (k[0] === 't') { const base = P.buf !== '' ? P.buf : (fmtV(cellsOf(a)[P.cur.e]) === '–' ? '' : fmtV(cellsOf(a)[P.cur.e])); const ip = Math.floor(num(base)); P.buf = k === 't0' ? String(ip) : ip + ',' + k[1]; }
      else {
        const key = k.slice(1);
        if (a.unite === 'litres') { P.kegT = true; if (P.chip) { P.buf = ''; P.chip = false; } }
        if (key === '⌫') P.buf = P.buf.slice(0, -1);
        else if (key === ',') P.buf = P.buf.includes(',') ? P.buf : (P.buf === '' ? '0,' : P.buf + ',');
        else P.buf = (P.buf === '0' ? '' : P.buf) + key;
      }
      drawPhone();
    });
  }
  function scrollKp() { const c = document.querySelector('.kprow'); if (c) c.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }

  async function valider() {
    const { sb, toast } = C();
    if (P.cur) { commit(); P.cur = null; }
    const btn = document.getElementById('valider'); if (btn) { btn.disabled = true; btn.textContent = 'Vérification…'; }
    // 1. tout doit être enregistré ; 2. on repart des valeurs de la base (pas de l'écran)
    await flush();
    if (P.pending.size) { toast('Pas de réseau : des saisies ne sont pas encore enregistrées. Réessaie dans un instant.'); drawPhone(); return; }
    const { data: enBase, error: eLect } = await sb.from('bar_comptage_lignes').select('*').eq('comptage_id', P.comptage.id);
    if (eLect) { toast('Pas de réseau : réessaie dans un instant.'); drawPhone(); return; }
    P.articles.forEach(a => { P.vals[a.id] = {}; P.rvals[a.id] = P.rvals[a.id] || {}; });
    (enBase || []).forEach(l => { const t = l.recompte ? P.rvals : P.vals; if (t[l.article_id]) t[l.article_id][l.emplacement] = String(l.quantite); });
    const [f0, t0] = remplies();
    if (f0 < t0) { toast(`${t0 - f0} case${t0 - f0 > 1 ? 's' : ''} non enregistrée${t0 - f0 > 1 ? 's' : ''} : ressaisis les cases vides.`); drawPhone(); return; }
    P.stock = await stockDuJour(P.date);
    if (P.phase === 'count' && P.stock) {
      const R = await reglages();
      const th = await theoriques(P.stock.id, P.articles.map(a => a.nom_bizzon));
      const pertes = await pertesEnCours(P.articles.map(a => a.nom_bizzon), new Date().toISOString());
      const hors = P.articles.filter(a => { const t = th[a.nom_bizzon]; return t && T.ecart(totalOf(a), Number(t.prevu), pertes[a.nom_bizzon] || 0, Number(t.prix), a.unite, R.seuils, a.type).hors; }).map(a => a.id);
      if (hors.length) {
        const { data } = await sb.from('bar_comptages').update({ recompte_ids: hors, import_stock_id: P.stock.id }).eq('id', P.comptage.id).select().single();
        P.comptage = data; P.phase = 'recount';
        hors.forEach(id => { P.rvals[id] = {}; });
        toast(`${hors.length} article${hors.length > 1 ? 's' : ''} à recompter tout de suite`);
        drawPhone(); window.scrollTo({ top: 0, behavior: 'smooth' }); return;
      }
    }
    const { data, error } = await sb.from('bar_comptages').update({ valide_le: new Date().toISOString(), import_stock_id: P.stock ? P.stock.id : null }).eq('id', P.comptage.id).select().single();
    if (error) { toast('Validation impossible : ' + error.message); drawPhone(); return; }
    P.comptage = data; P.phase = 'done'; toast('Comptage validé'); drawPhone();
  }

  /* ================= Ordinateur : écarts ================= */
  let selCpt = null;
  async function ecarts(M) {
    const { sb, esc, fr, eur, fmtD, fmtDT } = C();
    M.innerHTML = `<div class="hint">Chargement des écarts…</div>`;
    const { data: cpts } = await sb.from('bar_comptages').select('*').order('date_jour', { ascending: false }).limit(60);
    if (!cpts || !cpts.length) { M.innerHTML = `<div class="main-h"><div><h2>Écarts</h2><p>Aucun comptage pour l'instant.</p></div></div><div class="empty">Les écarts apparaîtront après le premier comptage sur téléphone.</div>`; return; }
    const cpt = cpts.find(c => c.id === selCpt) || cpts[0]; selCpt = cpt.id;
    const rows = await calculerEcarts(cpt.id);
    const conf = rows.filter(r => r.statut === 'Écart confirmé' || r.statut === 'À recontrôler');
    const totEv = rows.reduce((s, r) => s + (r.ev || 0), 0);
    const pill = s => `<span class="pill ${s.startsWith('Conforme') ? 'p-ok' : s === 'Écart confirmé' ? 'p-bad' : s === 'À recontrôler' ? 'p-warn' : 'p-mute'}">${s}</span>`;
    const grp = (lbl, list) => `<tr class="grp"><td colspan="9">${lbl}</td></tr>` + list.map(r => `<tr>
      <td>${esc(r.article.nom_court)}${r.article.motif === 'recontrole' ? ' <span class="pill p-warn">recontrôle</span>' : ''}</td>
      <td class="hint">${r.article.emplacements.map(e => `${COLS[e].slice(0, 3)}. ${r.qte[e] !== undefined ? fr(r.qte[e]) : '–'}`).join(' · ')}</td>
      <td class="n">${r.complet ? fr(r.total, 3) : '–'}</td><td class="n">${r.theo !== null ? fr(r.theo, 3) : '–'}</td><td class="n">${r.pertes ? fr(r.pertes) : '0'}</td>
      <td class="n ${r.e < 0 ? 'neg' : r.e > 0 ? 'pos' : ''}">${r.e === null ? '–' : (r.e > 0 ? '+' : '') + fr(r.e, 3) + ' ' + U[r.article.unite]}</td>
      <td class="n ${r.ev < 0 ? 'neg' : ''}">${r.ev === null ? '–' : eur(r.ev)}</td><td>${pill(r.statut)}</td>
      <td>${r.hors ? `<div class="cause"><select data-cause="${r.article.id}" aria-label="Cause"><option value="">Cause…</option>${CAUSES.concat(r.cause && !CAUSES.includes(r.cause.cause) ? [r.cause.cause] : []).map(c => `<option ${r.cause && r.cause.cause === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <input data-note="${r.article.id}" maxlength="200" placeholder="Précision (libre)…" aria-label="Précision sur la cause" value="${esc(r.cause && r.cause.note || '')}"></div>` : ''}</td></tr>`).join('');
    M.innerHTML = `<div class="main-h"><div><h2>Écarts</h2><p>Écart = compté − (théorique − pertes déclarées pas encore transférées dans Bizzon). Négatif = manque.</p></div>
      <select id="cptSel" aria-label="Jour de comptage" style="font:inherit;font-weight:700;padding:8px 10px;border:1.5px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink)">${cpts.map(c => `<option value="${c.id}" ${c.id === cpt.id ? 'selected' : ''}>${cap(fmtD(c.date_jour))}${c.valide_le ? '' : ' (en cours)'}</option>`).join('')}</select></div>
      <div class="tiles">
        <div class="tile ${cpt.valide_le ? '' : 'warm'}"><div class="k">Comptage</div><div class="v" style="font-size:20px">${cpt.valide_le ? fmtDT(cpt.valide_le).split(' à ')[1] : 'en cours'}</div><div class="s">${rows.length} articles${(cpt.recompte_ids || []).length ? ` · ${cpt.recompte_ids.length} recomptés sur place` : ''}</div></div>
        <div class="tile"><div class="k">Écarts hors seuil</div><div class="v ${conf.length ? 'neg' : ''}">${conf.length}</div><div class="s">${conf.map(r => esc(r.article.nom_court)).join(', ') || 'aucun'}</div></div>
        <div class="tile"><div class="k">Écart valorisé</div><div class="v ${totEv < 0 ? 'neg' : ''}">${eur(totEv)}</div><div class="s">prix unitaire Bizzon</div></div>
        <div class="tile"><div class="k">Stock théorique de référence</div><div class="v" style="font-size:16px;font-family:var(--body)">${rows.some(r => r.theo !== null) ? 'importé' : 'absent'}</div><div class="s">${rows.some(r => r.theo !== null) ? '' : 'Importe le stock du jour sur la page Aujourd’hui'}</div></div>
      </div>
      <div class="tbl"><table class="t"><thead><tr><th>Article</th><th>Détail compté</th><th class="n">Compté</th><th class="n">Théorique</th><th class="n">Pertes décl.</th><th class="n">Écart</th><th class="n">Écart €</th><th>Statut</th><th>Cause</th></tr></thead><tbody>
        ${grp('Bar', rows.filter(r => r.article.type !== 'canette'))}${grp('Canettes', rows.filter(r => r.article.type === 'canette'))}
      </tbody></table></div>
      <span class="hint">« À recontrôler » : hors seuil sans recompte sur place (stock importé après le comptage) ; l'article sera recompté au prochain comptage. Seuils : 5 L, 0,2 bouteille, 1 canette, 0 pièce ou 10 €.</span>`;
    M.querySelector('#cptSel').onchange = e => { selCpt = +e.target.value; ecarts(M); };
    const saveCause = async aid => {
      const sel = M.querySelector(`[data-cause="${aid}"]`), note = M.querySelector(`[data-note="${aid}"]`).value.trim();
      if (!sel.value && note) sel.value = 'Autre';
      const q = sel.value ? sb.from('bar_causes').upsert({ comptage_id: cpt.id, article_id: aid, cause: sel.value, note: note || null }, { onConflict: 'comptage_id,article_id' })
        : sb.from('bar_causes').delete().eq('comptage_id', cpt.id).eq('article_id', aid);
      const { error } = await q; C().toast(error ? 'Cause non enregistrée : ' + error.message : 'Cause enregistrée');
    };
    M.querySelectorAll('[data-cause]').forEach(s => s.onchange = () => saveCause(+s.dataset.cause));
    M.querySelectorAll('[data-note]').forEach(i => { i.onchange = () => saveCause(+i.dataset.note); i.onkeydown = e => { if (e.key === 'Enter') i.blur(); }; });
  }

  /* ================= Ordinateur : calendrier ================= */
  async function calendrierView(M) {
    const { sb, todayParis, fmtD } = C();
    const start = T.lundi(todayParis()), end = T.addDays(start, 34);
    const cal = await calendrier(start, end);
    const days = Array.from({ length: 35 }, (_, i) => T.addDays(start, i));
    M.innerHTML = `<div class="main-h"><div><h2>Calendrier de comptage</h2><p>Lundi au vendredi à 08h00 par défaut. Le week-end, seulement si tu l'actives (garde), à 10h00. Clique sur un jour pour l'activer ou le désactiver. « Salsa » marque une soirée salsa : au comptage suivant, le Havana Club 3 ans, le 7 ans et le Dillon blanc sont comptés d'office.</p></div></div>
      <div class="calg">${['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map(h => `<div class="h">${h}</div>`).join('')}
      ${days.map(d => { const on = T.jourActif(d, cal), we = T.isoDow(d) >= 6, sal = cal[d] && cal[d].salsa, past = d < todayParis();
        return `<div class="cday ${on ? (we ? 'we' : 'on') : 'off'} ${d === todayParis() ? 'today' : ''} ${past ? 'past' : ''}">
          <button class="cd-main" data-day="${d}" ${past ? 'disabled' : ''}><b>${Number(d.slice(8))}</b><span>${on ? (we ? '10h00 · garde' : '08h00') : 'Pas de comptage'}</span></button>
          <button class="cd-salsa ${sal ? 'is' : ''}" data-salsa="${d}" aria-pressed="${!!sal}">♪ Salsa</button></div>`; }).join('')}</div>
      <span class="hint">Un jour sauté ne fait perdre son tour à aucun article : la liste prioritaire se répartit sur les jours restants de la semaine.</span>`;
    const save = async (d, patch) => {
      const cur = cal[d] || { date_jour: d, actif: null, salsa: false };
      const row = { date_jour: d, actif: cur.actif ?? null, salsa: !!cur.salsa, ...patch };
      const { error } = await sb.from('bar_calendrier').upsert(row, { onConflict: 'date_jour' });
      if (error) C().toast(/salsa/.test(error.message) ? 'Lance le script SQL 03 dans Supabase.' : 'Non enregistré : ' + error.message);
      calendrierView(M);
    };
    M.querySelectorAll('[data-day]').forEach(b => b.onclick = () => { const d = b.dataset.day; const def = T.isoDow(d) <= 5; const now = T.jourActif(d, cal); save(d, { actif: !now === def ? null : !now }); });
    M.querySelectorAll('[data-salsa]').forEach(b => b.onclick = () => { const d = b.dataset.salsa; save(d, { salsa: !(cal[d] && cal[d].salsa) }); });
  }

  /* ================= Ordinateur : état du comptage du jour (page Aujourd'hui) ================= */
  async function statutDuJour(el, voirEcarts) {
    const { sb, todayParis, fmtDT, esc } = C();
    const date = todayParis();
    const { data: cpt } = await sb.from('bar_comptages').select('*').eq('date_jour', date).maybeSingle();
    let titre, detail, cls = '', btn = false;
    if (!cpt || !cpt.tirage_ok) {
      const cal = await calendrier(date, date);
      titre = T.jourActif(date, cal) ? 'Comptage du jour pas encore commencé' : 'Pas de comptage prévu aujourd’hui';
      detail = T.jourActif(date, cal) ? 'Il se fait sur téléphone : ouvre l’app sur ton iPhone (ou celui de Christophe).' : 'Modifiable dans Réglages › Calendrier.';
    } else {
      const arts = await lireTirage(date);
      const { data: lignes } = await sb.from('bar_comptage_lignes').select('article_id,emplacement').eq('comptage_id', cpt.id).eq('recompte', false);
      const total = arts.reduce((s, a) => s + a.emplacements.length, 0), n = (lignes || []).length;
      if (cpt.valide_le) {
        const rows = await calculerEcarts(cpt.id);
        const hors = rows.filter(r => r.hors);
        cls = hors.length ? 'old' : 'ok'; btn = true;
        titre = `Comptage validé à ${fmtDT(cpt.valide_le).split(' à ')[1]}`;
        detail = `${arts.length} articles · ${(cpt.recompte_ids || []).length} recompté(s) sur place · ` + (hors.length ? `<b>${hors.length} écart${hors.length > 1 ? 's' : ''} hors seuil</b> : ${hors.map(r => esc(r.article.nom_court)).join(', ')}` : 'aucun écart hors seuil');
      } else {
        titre = (cpt.recompte_ids || []).length ? 'Recompte en cours sur téléphone' : 'Comptage en cours sur téléphone';
        detail = `${Math.min(n, total)} case${n > 1 ? 's' : ''} sur ${total} saisie${n > 1 ? 's' : ''}.`;
      }
    }
    el.innerHTML = `<div class="imp ${cls}" style="margin-top:-6px"><span class="dot"></span><div style="flex:1"><div class="k">${titre}</div><div class="hint">${detail}</div></div>${btn ? '<button class="btn sm" id="goEc">Voir les écarts</button>' : ''}</div>`;
    const g = el.querySelector('#goEc'); if (g) g.onclick = voirEcarts;
  }

  window.BarViews = { phone, ecarts, calendrier: calendrierView, statutDuJour };
})();
