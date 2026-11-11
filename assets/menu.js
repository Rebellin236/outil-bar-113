/* Outil Bar 1.13 — menu engineering (méthode Kasavana & Smith, 1982)
   Popularité = part des ventes de l'article dans sa section ; seuil = 70 % de la part moyenne (0,7 ÷ nombre d'articles).
   Marge = prix de vente HT moyen réellement encaissé − coût matière de la fiche ; seuil = marge moyenne pondérée par les ventes.
   Étoile : populaire et rentable · Cheval de labour : populaire, marge faible · Énigme : rentable, peu vendu · Poids mort : ni l'un ni l'autre. */
(function () {
  'use strict';
  const C = () => window.BarCtx;
  const T = () => window.BarTirage;
  const CL = {
    star: { nom: 'Étoile', en: 'Star', forme: 'circle', reco: 'À garder tel quel : visibilité en haut de carte, qualité constante. Tester une hausse de prix modérée.' },
    plow: { nom: 'Cheval de labour', en: 'Plowhorse', forme: 'square', reco: 'Se vend bien mais rapporte peu : revoir la dose ou le coût de la recette, ou monter légèrement le prix.' },
    puzzle: { nom: 'Énigme', en: 'Puzzle', forme: 'diamond', reco: 'Rentable mais peu vendu : mieux le placer sur la carte, le faire suggérer par l’équipe, revoir le nom ou la description.' },
    dog: { nom: 'Poids mort', en: 'Dog', forme: 'triangle', reco: 'Ni populaire ni rentable : le retirer, ou le repenser (recette, prix, présentation).' }
  };
  const sansAccent = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  let S = { periode: '30', pv: 'BAR 1.13', cat: '', debut: '', fin: '', tri: 'classe', survol: null };

  function bornes(auj) {
    if (S.periode === 'perso' && S.debut && S.fin) return [S.debut, S.fin];
    if (S.periode === 'mois') return [auj.slice(0, 8) + '01', auj];
    if (S.periode === 'moisp') { const d = T().addDays(auj.slice(0, 8) + '01', -1); return [d.slice(0, 8) + '01', d]; }
    return [T().addDays(auj, -Number(S.periode)), T().addDays(auj, -1)];
  }

  async function vue(M) {
    const { sb, tout, esc, fr, eur, todayParis, fmtD } = C();
    const auj = todayParis();
    const [d0, d1] = bornes(auj);
    M.innerHTML = '<div class="hint">Calcul du menu engineering…</div>';
    const [{ data: ventes }, { data: fiches, error }, { data: lignes }] = await Promise.all([
      tout(() => sb.from('bar_ventes').select('date_vente,article,point_vente,quantite,net_ht').gte('date_vente', d0).lte('date_vente', d1).order('id')),
      tout(() => sb.from('bar_fiches').select('*').order('id')),
      tout(() => sb.from('bar_fiche_lignes').select('*').order('id'))]);
    if (error) { M.innerHTML = `<div class="main-h"><div><h2>Menu engineering</h2></div></div><div class="empty">Lance d'abord le script SQL 05 et importe l'export « Produits à vendre ».</div>`; return; }
    const { data: imp } = await sb.from('bar_imports').select('id,exporte_le').eq('type', 'stock').order('exporte_le', { ascending: false }).limit(1);
    const stock = imp && imp[0] ? (await tout(() => sb.from('bar_stock_theo').select('nom_bizzon,prix').eq('import_id', imp[0].id).order('id'))).data || [] : [];
    const prix = Object.fromEntries(stock.map(s => [s.nom_bizzon, s]));
    const parFiche = {}; (lignes || []).forEach(l => (parFiche[l.fiche_id] = parFiche[l.fiche_id] || []).push(l));
    const ficheDe = new Map((fiches || []).map(f => [sansAccent(f.produit + (f.variante ? ': ' + f.variante : '')), f]));
    // Ventes du point de vente, regroupées par article vendu
    const pvs = [...new Set((ventes || []).map(v => v.point_vente))].sort();
    const jours = new Set((ventes || []).map(v => v.date_vente)).size;
    const agg = new Map();
    for (const v of ventes || []) {
      if (S.pv && v.point_vente !== S.pv) continue;
      const f = ficheDe.get(sansAccent(v.article)); if (!f) continue;
      const a = agg.get(f.id) || { f, q: 0, ca: 0 }; a.q += Number(v.quantite); a.ca += Number(v.net_ht); agg.set(f.id, a);
    }
    const cats = [...new Set([...agg.values()].map(a => a.f.categorie || 'Sans catégorie'))].sort();
    if (!S.cat || !cats.includes(S.cat)) S.cat = cats.includes('Cocktail Alcool') ? 'Cocktail Alcool' : cats[0] || '';
    // Articles de la section : ceux vendus + ceux de la carte (fiche active) non vendus sur la période
    const section = [...agg.values()].filter(a => (a.f.categorie || 'Sans catégorie') === S.cat);
    (fiches || []).filter(f => f.actif && (f.categorie || 'Sans catégorie') === S.cat && !agg.has(f.id)).forEach(f => section.push({ f, q: 0, ca: 0 }));
    const items = section.map(a => {
      const c = window.BarFiches.cout(parFiche[a.f.id] || [], prix);
      const pvHT = a.q > 0 ? a.ca / a.q : (a.f.prix_ttc !== null && a.f.tva !== null ? a.f.prix_ttc / (1 + a.f.tva / 100) : null);
      return { ...a, cout: c.complet ? c.cout : null, pvHT, marge: c.complet && pvHT !== null ? pvHT - c.cout : null };
    });
    const jamais = items.filter(x => x.q <= 0); // à la carte mais pas vendus sur la période : listés à part, hors calcul des seuils
    const ok = items.filter(x => x.marge !== null && x.q > 0), sansFiche = items.filter(x => x.marge === null && x.q > 0);
    const qTot = ok.reduce((s, x) => s + x.q, 0), N = ok.length;
    const seuilPop = N ? 0.7 / N : 0;
    const margeMoy = qTot ? ok.reduce((s, x) => s + x.marge * x.q, 0) / qTot : 0;
    ok.forEach(x => { x.mix = qTot ? x.q / qTot : 0; x.mTot = x.marge * x.q; x.ratio = x.pvHT ? x.cout / x.pvHT : null;
      x.cl = x.mix >= seuilPop ? (x.marge >= margeMoy ? 'star' : 'plow') : (x.marge >= margeMoy ? 'puzzle' : 'dog'); });
    const ordre = { star: 0, plow: 1, puzzle: 2, dog: 3 };
    ok.sort((a, b) => S.tri === 'marge' ? b.mTot - a.mTot : S.tri === 'ventes' ? b.q - a.q : (ordre[a.cl] - ordre[b.cl]) || (b.mTot - a.mTot));
    const caTot = ok.reduce((s, x) => s + x.ca, 0), mBrute = ok.reduce((s, x) => s + x.mTot, 0), coutTot = ok.reduce((s, x) => s + x.cout * x.q, 0);
    const qSans = sansFiche.reduce((s, x) => s + x.q, 0);
    const nb = k => ok.filter(x => x.cl === k).length;
    const per = `${fmtD(d0).replace(/^\w+ /, '')} au ${fmtD(d1).replace(/^\w+ /, '')}`;

    M.innerHTML = `<div class="main-h"><div><h2>Menu engineering</h2><p>Méthode Kasavana &amp; Smith : popularité (part des ventes dans la section) × marge brute unitaire HT. Seuil de popularité = 70 % de la part moyenne ; seuil de marge = marge moyenne pondérée par les ventes. Une section de carte à la fois.</p></div></div>
      <div class="filtres">
        <select id="mePer" class="sel" aria-label="Période">${[['7', '7 derniers jours'], ['30', '30 derniers jours'], ['90', '90 derniers jours'], ['mois', 'Mois en cours'], ['moisp', 'Mois précédent'], ['perso', 'Dates choisies']].map(([k, l]) => `<option value="${k}" ${k === S.periode ? 'selected' : ''}>${l}</option>`).join('')}</select>
        ${S.periode === 'perso' ? `<input type="date" id="meD0" class="sel" value="${S.debut || d0}"><input type="date" id="meD1" class="sel" value="${S.fin || d1}">` : ''}
        <select id="mePv" class="sel" aria-label="Point de vente">${pvs.filter(p => p !== 'BANQUET').map(p => `<option ${p === S.pv ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>
        <select id="meCat" class="sel" aria-label="Section de la carte">${cats.map(c => `<option ${c === S.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <span class="hint">${per} · ${jours} jour${jours > 1 ? 's' : ''} de ventes importés</span></div>
      ${!N ? `<div class="empty">Aucun article de cette section avec une fiche complète et des ventes sur la période. Complète les fiches dans « Fiches et ratios » ou élargis la période.</div>` : `
      <div class="tiles">
        <div class="tile"><div class="k">CA HT analysé</div><div class="v">${eur(caTot)}</div><div class="s">${fr(qTot)} ventes, ${N} articles</div></div>
        <div class="tile"><div class="k">Marge brute HT</div><div class="v">${eur(mBrute)}</div><div class="s">ratio matière ${caTot ? fr(coutTot / caTot * 100, 1) : '–'} %</div></div>
        <div class="tile"><div class="k">Seuils</div><div class="v" style="font-size:18px">${fr(seuilPop * 100, 1)} % · ${eur(margeMoy)}</div><div class="s">popularité · marge unitaire</div></div>
        <div class="tile ${sansFiche.length ? 'warm' : ''}"><div class="k">Hors analyse (sans fiche)</div><div class="v">${sansFiche.length}</div><div class="s">${fr(qSans)} vente${qSans > 1 ? 's' : ''} non analysée${qSans > 1 ? 's' : ''}</div></div>
      </div>
      <div class="me-grid"><div class="card me-chart"><h3>Carte de la section</h3>${graphe(ok, seuilPop, margeMoy)}
        <div class="me-leg">${Object.entries(CL).map(([k, c]) => `<span><svg width="14" height="14" aria-hidden="true">${marque(c.forme, 7, 7, 5.5, `var(--me-${k})`)}</svg>${c.nom} <b>${nb(k)}</b></span>`).join('')}</div></div>
        <div class="card me-q">${Object.entries(CL).map(([k, c]) => `<div class="me-qc"><div class="me-qh"><svg width="14" height="14" aria-hidden="true">${marque(c.forme, 7, 7, 5.5, `var(--me-${k})`)}</svg><b>${c.nom}</b><span class="hint">${c.en} · ${nb(k)}</span></div><p>${c.reco}</p></div>`).join('')}</div></div>
      <div class="filtres"><select id="meTri" class="sel">${[['classe', 'Trier : par classe'], ['marge', 'Trier : marge totale'], ['ventes', 'Trier : ventes']].map(([k, l]) => `<option value="${k}" ${k === S.tri ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="tbl"><table class="t me-t"><thead><tr><th>Article</th><th class="n">Ventes</th><th class="n">Part</th><th class="n">Prix moyen HT</th><th class="n">Coût</th><th class="n">Ratio</th><th class="n">Marge unitaire</th><th class="n">Marge totale</th><th>Classe</th></tr></thead><tbody>
        ${ok.map(x => `<tr data-id="${x.f.id}" class="${S.survol === x.f.id ? 'hl' : ''}"><td><b>${esc(x.f.produit)}</b>${x.f.variante ? ` <span class="hint">${esc(x.f.variante)}</span>` : ''}</td><td class="n">${fr(x.q)}</td><td class="n ${x.mix < seuilPop ? 'faible' : ''}">${fr(x.mix * 100, 1)} %</td>
          <td class="n">${eur(x.pvHT)}</td><td class="n">${eur(x.cout)}</td><td class="n">${x.ratio === null ? '–' : fr(x.ratio * 100, 1) + ' %'}</td><td class="n ${x.marge < margeMoy ? 'faible' : ''}">${eur(x.marge)}</td><td class="n">${eur(x.mTot)}</td>
          <td><span class="me-pill"><svg width="12" height="12" aria-hidden="true">${marque(CL[x.cl].forme, 6, 6, 4.8, `var(--me-${x.cl})`)}</svg>${CL[x.cl].nom}</span></td></tr>`).join('')}
      </tbody></table></div>`}
      ${jamais.length ? `<details class="card"><summary><b>${jamais.length} article${jamais.length > 1 ? 's' : ''} de la section jamais vendu${jamais.length > 1 ? 's' : ''} sur la période</b> <span class="hint">: candidats au retrait de la carte (à juger sur une période assez longue)</span></summary>
        <div class="tbl"><table class="t"><tbody>${jamais.sort((a, b) => a.f.produit.localeCompare(b.f.produit)).map(x => `<tr><td>${esc(x.f.produit)}${x.f.variante ? ' · ' + esc(x.f.variante) : ''}</td><td class="n">${x.pvHT === null ? '–' : eur(x.pvHT) + ' HT'}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
      ${sansFiche.length ? `<details class="card"><summary><b>${sansFiche.length} article${sansFiche.length > 1 ? 's' : ''} de la section sans fiche complète</b> <span class="hint">: exclus de l'analyse, à compléter dans Fiches et ratios</span></summary>
        <div class="tbl"><table class="t"><tbody>${sansFiche.sort((a, b) => b.q - a.q).map(x => `<tr><td>${esc(x.f.produit)}${x.f.variante ? ' · ' + esc(x.f.variante) : ''}</td><td class="n">${fr(x.q)} vente${x.q > 1 ? 's' : ''}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
      <span class="hint">Prix moyen HT = CA net HT encaissé ÷ quantité (remises déduites). Seuls les articles vendus sur la période entrent dans le calcul ; plus la période est longue, plus le classement est fiable (30 jours minimum conseillés). Coût = fiche technique × prix d'achat du dernier stock importé. Ventes issues des imports « Analyse des ventes » (jours non importés absents).</span>`;
    const re = () => vue(M);
    M.querySelector('#mePer').onchange = e => { S.periode = e.target.value; re(); };
    const a0 = M.querySelector('#meD0'), a1 = M.querySelector('#meD1');
    if (a0) a0.onchange = () => { S.debut = a0.value; S.fin = a1.value; re(); };
    if (a1) a1.onchange = () => { S.debut = a0.value; S.fin = a1.value; re(); };
    M.querySelector('#mePv').onchange = e => { S.pv = e.target.value; re(); };
    M.querySelector('#meCat').onchange = e => { S.cat = e.target.value; re(); };
    const tri = M.querySelector('#meTri'); if (tri) tri.onchange = e => { S.tri = e.target.value; re(); };
    bindGraphe(M, ok);
  }

  /* ---------- Graphe popularité × marge (SVG) ---------- */
  function marque(forme, x, y, r, fill) {
    if (forme === 'square') return `<rect x="${x - r * 0.85}" y="${y - r * 0.85}" width="${r * 1.7}" height="${r * 1.7}" rx="1.5" fill="${fill}"/>`;
    if (forme === 'diamond') return `<path d="M${x} ${y - r * 1.15}L${x + r * 1.15} ${y}L${x} ${y + r * 1.15}L${x - r * 1.15} ${y}Z" fill="${fill}"/>`;
    if (forme === 'triangle') return `<path d="M${x} ${y - r * 1.1}L${x + r * 1.05} ${y + r * 0.8}L${x - r * 1.05} ${y + r * 0.8}Z" fill="${fill}"/>`;
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`;
  }
  function graphe(ok, seuilPop, margeMoy) {
    const { fr, eur, esc } = C();
    const W = 640, H = 380, m = { l: 62, r: 16, t: 14, b: 42 };
    const xMax = Math.max(seuilPop * 2.2, ...ok.map(x => x.mix)) * 1.08;
    const yMin = Math.min(0, ...ok.map(x => x.marge)), yMax = Math.max(margeMoy * 1.6, ...ok.map(x => x.marge)) * 1.08;
    const X = v => m.l + v / xMax * (W - m.l - m.r), Y = v => H - m.b - (v - yMin) / (yMax - yMin || 1) * (H - m.t - m.b);
    const tx = [0, .25, .5, .75, 1].map(k => k * xMax), ty = [0, .25, .5, .75, 1].map(k => yMin + k * (yMax - yMin));
    // Étiquettes directes : les plus gros contributeurs, sans chevauchement
    const top = [], poses = [];
    for (const x of [...ok].sort((a, b) => b.mTot - a.mTot)) {
      if (top.length >= 6) break;
      const px = X(x.mix), py = Y(x.marge);
      if (poses.some(p => Math.abs(p[1] - py) < 15 && px + 140 > p[0] && px < p[0] + 140)) continue;
      top.push(x.f.id); poses.push([px, py]);
    }
    return `<svg class="me-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Popularité en abscisse, marge unitaire en ordonnée ; ${ok.length} articles">
      <rect x="${X(seuilPop)}" y="${m.t}" width="${W - m.r - X(seuilPop)}" height="${Y(margeMoy) - m.t}" class="q-star"/>
      ${ty.map(v => `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${m.l - 8}" y="${Y(v) + 4}" class="tick" text-anchor="end">${eur(v).replace(',00', '')}</text>`).join('')}
      ${tx.map(v => `<text x="${X(v)}" y="${H - m.b + 18}" class="tick" text-anchor="middle">${fr(v * 100, 0)} %</text>`).join('')}
      <line x1="${X(seuilPop)}" x2="${X(seuilPop)}" y1="${m.t}" y2="${H - m.b}" class="seuil"/><line x1="${m.l}" x2="${W - m.r}" y1="${Y(margeMoy)}" y2="${Y(margeMoy)}" class="seuil"/>
      <text x="${W - m.r - 4}" y="${m.t + 14}" text-anchor="end" class="qlab">Étoiles</text><text x="${m.l + 6}" y="${m.t + 14}" class="qlab">Énigmes</text>
      <text x="${W - m.r - 4}" y="${H - m.b - 8}" text-anchor="end" class="qlab">Chevaux de labour</text><text x="${m.l + 6}" y="${H - m.b - 8}" class="qlab">Poids morts</text>
      <text x="${(m.l + W - m.r) / 2}" y="${H - 6}" text-anchor="middle" class="axe">Popularité (part des ventes de la section)</text>
      <text transform="translate(14 ${(m.t + H - m.b) / 2}) rotate(-90)" text-anchor="middle" class="axe">Marge unitaire HT</text>
      ${ok.map(x => `<g class="pt" data-id="${x.f.id}" tabindex="0"><circle cx="${X(x.mix)}" cy="${Y(x.marge)}" r="14" fill="transparent"/>${marque(CL[x.cl].forme, X(x.mix), Y(x.marge), 6, `var(--me-${x.cl})`).replace('/>', ' class="mk"/>')}
        ${top.includes(x.f.id) ? `<text x="${X(x.mix) + 10}" y="${Y(x.marge) + 4}" class="lab">${esc(x.f.produit.length > 22 ? x.f.produit.slice(0, 21) + '…' : x.f.produit)}</text>` : ''}</g>`).join('')}
    </svg><div class="me-tip" hidden></div>`;
  }
  function bindGraphe(M, ok) {
    const { fr, eur, esc } = C();
    const tip = M.querySelector('.me-tip'); if (!tip) return;
    const box = M.querySelector('.me-chart');
    const montrer = (g, on) => {
      const x = ok.find(o => o.f.id === +g.dataset.id); if (!x) return;
      M.querySelectorAll(`tr[data-id="${x.f.id}"]`).forEach(tr => tr.classList.toggle('hl', on));
      if (!on) { tip.hidden = true; return; }
      tip.innerHTML = `<b>${esc(x.f.produit)}${x.f.variante ? ' · ' + esc(x.f.variante) : ''}</b><span>${CL[x.cl].nom}</span><span>${fr(x.q)} ventes · ${fr(x.mix * 100, 1)} % de la section</span><span>Marge ${eur(x.marge)} / unité · ${eur(x.mTot)} au total</span>`;
      const r = g.getBoundingClientRect(), b = box.getBoundingClientRect();
      tip.style.left = Math.min(r.left - b.left + 16, b.width - 230) + 'px'; tip.style.top = (r.top - b.top - 10) + 'px'; tip.hidden = false;
    };
    M.querySelectorAll('.pt').forEach(g => { g.onmouseenter = g.onfocus = () => montrer(g, true); g.onmouseleave = g.onblur = () => montrer(g, false); });
  }

  window.BarMenu = { vue };
})();
