/* Outil Bar 1.13 — synthèse de la semaine : chaque jour compté, ses écarts, et ce qui revient d'un jour à l'autre */
(function () {
  'use strict';
  const C = () => window.BarCtx;
  const T = () => window.BarTirage;
  const U = { litres: 'L', bouteilles: 'btl', pieces: 'pc' };
  const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
  let lundiSel = null, ouverts = new Set();

  async function semaine(M) {
    const { sb, esc, fr, eur, fmtDT, todayParis } = C();
    const auj = todayParis();
    if (!lundiSel) lundiSel = T().lundi(auj);
    const lun = lundiSel, dim = T().addDays(lun, 6);
    M.innerHTML = '<div class="hint">Chargement de la semaine…</div>';
    const [{ data: cpts }, { data: cal }, { data: pertes }, { data: avant }] = await Promise.all([
      sb.from('bar_comptages').select('*').gte('date_jour', lun).lte('date_jour', dim).order('date_jour'),
      sb.from('bar_calendrier').select('*').gte('date_jour', lun).lte('date_jour', dim),
      sb.from('bar_pertes').select('nom_bizzon,quantite,statut,cree_le').gte('cree_le', new Date(Date.parse(lun + 'T00:00:00Z') - 2 * 3600e3).toISOString()).lte('cree_le', new Date(Date.parse(dim + 'T23:59:59Z')).toISOString()),
      sb.from('bar_comptages').select('*').lt('date_jour', lun).not('valide_le', 'is', null).order('date_jour', { ascending: false }).limit(1)]);
    const calBy = Object.fromEntries((cal || []).map(c => [c.date_jour, c]));
    // Écarts de chaque jour compté (et du dernier comptage avant la semaine, pour la variation du lundi)
    const ref = [...(avant || []), ...(cpts || [])];
    const ecarts = {};
    for (const c of ref) ecarts[c.date_jour] = await window.BarViews.calculerEcarts(c.id);
    const dernier = {}; // dernier écart connu de chaque article, au fil des jours
    const varia = {};
    for (const c of ref) for (const r of ecarts[c.date_jour]) {
      if (r.e === null) continue;
      const p = dernier[r.article.id];
      varia[c.date_jour + '|' + r.article.id] = p ? { v: +(r.e - p.e).toFixed(3), d: p.d } : null;
      dernier[r.article.id] = { e: r.e, d: c.date_jour };
    }
    const jours = Array.from({ length: 7 }, (_, i) => T().addDays(lun, i));
    const cptBy = Object.fromEntries((cpts || []).map(c => [c.date_jour, c]));
    // Indicateurs de la semaine
    const valides = (cpts || []).filter(c => c.valide_le);
    const prevus = jours.filter(d => d <= auj && T().jourActif(d, calBy));
    const toutes = valides.flatMap(c => ecarts[c.date_jour].map(r => ({ ...r, d: c.date_jour })));
    const hors = toutes.filter(r => r.hors);
    const sansCause = hors.filter(r => !r.cause);
    const totEv = hors.reduce((s, r) => s + (r.ev || 0), 0);
    const recur = {}; hors.forEach(r => (recur[r.article.id] = recur[r.article.id] || { a: r.article, jours: [] }).jours.push(r));
    const recurrents = Object.values(recur).filter(x => x.jours.length >= 2).sort((a, b) => b.jours.length - a.jours.length);
    const pv = (pertes || []).filter(p => p.statut !== 'refusee');
    const aVal = pv.filter(p => p.statut === 'a_valider').length;

    const cellE = r => r.e === null ? '–' : `<span class="${r.hors ? (r.e < 0 ? 'neg' : 'pos') : ''}">${r.e > 0 ? '+' : ''}${fr(r.e, 3)} ${U[r.article.unite]}</span>`;
    const pill = s => `<span class="pill ${s.startsWith('Conforme') ? 'p-ok' : s === 'Écart confirmé' ? 'p-bad' : s === 'À recontrôler' ? 'p-warn' : 'p-mute'}">${s}</span>`;
    const carteJour = (d, i) => {
      const c = cptBy[d], prevu = T().jourActif(d, calBy), salsa = calBy[d] && calBy[d].salsa;
      const tete = `<div class="sj-h"><div><b>${JOURS[i]} ${Number(d.slice(8))}/${d.slice(5, 7)}</b>${salsa ? ' <span class="pill" style="background:#7b2d6b;color:#fff">Salsa la veille</span>' : ''}</div>`;
      if (!c || !c.tirage_ok) return `<div class="sj vide">${tete}<span class="hint">${d > auj ? 'à venir' : prevu ? '<b style="color:var(--bad)">Comptage non fait</b>' : 'Pas de comptage prévu'}</span></div></div>`;
      if (!c.valide_le) return `<div class="sj vide">${tete}<span class="pill p-warn">En cours, non validé</span></div></div>`;
      const rows = ecarts[d], h = rows.filter(r => r.hors), ok = rows.filter(r => !r.hors);
      const ev = h.reduce((s, r) => s + (r.ev || 0), 0);
      const ouvert = ouverts.has(d);
      const ligne = r => { const v = varia[d + '|' + r.article.id];
        return `<tr class="${r.hors ? 'h' : ''}"><td>${esc(r.article.nom_court)}${r.article.type === 'canette' ? ' <span class="hint">canette</span>' : ''}</td><td class="n">${r.complet ? fr(r.total, 3) : '–'}</td><td class="n">${r.theo === null ? '–' : fr(r.theo, 3)}</td><td class="n">${cellE(r)}</td><td class="n">${r.ev === null ? '–' : eur(r.ev)}</td>
          <td class="n">${!v ? '<span class="hint">1er</span>' : `${v.v > 0 ? '+' : ''}${fr(v.v, 3)}`}</td><td>${pill(r.statut)}</td><td>${r.cause ? esc(r.cause.cause) + (r.cause.note ? `<div class="hint">${esc(r.cause.note)}</div>` : '') : r.hors ? '<span style="color:var(--bad);font-weight:700">à renseigner</span>' : ''}</td></tr>`; };
      return `<div class="sj ${h.length ? 'alerte' : 'net'}">${tete}<div class="sj-k"><span>Validé à ${fmtDT(c.valide_le).split(' à ')[1]}</span><span>${rows.length} articles</span><span>${(c.recompte_ids || []).length} recompte${(c.recompte_ids || []).length > 1 ? 's' : ''}</span></div></div>
        <div class="sj-r"><b class="${h.length ? 'neg' : ''}">${h.length ? `${h.length} écart${h.length > 1 ? 's' : ''} hors seuil` : 'Tout est conforme'}</b>${h.length ? `<span class="${ev < 0 ? 'neg' : ''}">${eur(ev)}</span>` : ''}</div>
        ${h.length ? `<div class="tbl"><table class="t sj-t"><thead><tr><th>Article</th><th class="n">Compté</th><th class="n">Théorique</th><th class="n">Écart</th><th class="n">€</th><th class="n">Variation</th><th>Statut</th><th>Cause</th></tr></thead><tbody>${h.map(ligne).join('')}</tbody></table></div>` : ''}
        ${ok.length ? `<button class="btn ghost sm" data-ouvre="${d}">${ouvert ? 'Masquer' : 'Voir'} ${ok.length > 1 ? `les ${ok.length} articles conformes` : 'l’article conforme'}</button>` : ''}
        ${ouvert && ok.length ? `<div class="tbl"><table class="t sj-t"><tbody>${ok.map(ligne).join('')}</tbody></table></div>` : ''}</div>`;
    };

    M.innerHTML = `<div class="main-h"><div><h2>Synthèse de la semaine</h2><p>Du lundi ${Number(lun.slice(8))}/${lun.slice(5, 7)} au dimanche ${Number(dim.slice(8))}/${dim.slice(5, 7)}. Chaque jour compté avec ses écarts hors seuil ; « Variation » = ce qui a bougé depuis le comptage précédent de l'article.</p></div>
        <div class="nav-sem"><button class="btn ghost sm" id="semPrev">‹ Semaine précédente</button><button class="btn ghost sm" id="semNext" ${T().addDays(lun, 7) > auj ? 'disabled' : ''}>Semaine suivante ›</button></div></div>
      <div class="tiles">
        <div class="tile ${valides.length < prevus.length ? 'warm' : ''}"><div class="k">Comptages faits</div><div class="v">${valides.length}/${prevus.length}</div><div class="s">jours prévus jusqu'à aujourd'hui</div></div>
        <div class="tile"><div class="k">Écarts hors seuil</div><div class="v ${hors.length ? 'neg' : ''}">${hors.length}</div><div class="s">sur ${toutes.length} lignes comptées</div></div>
        <div class="tile"><div class="k">Écart valorisé</div><div class="v ${totEv < 0 ? 'neg' : ''}">${eur(totEv)}</div><div class="s">écarts hors seuil, prix Bizzon</div></div>
        <div class="tile ${sansCause.length ? 'warm' : ''}"><div class="k">Causes à renseigner</div><div class="v">${sansCause.length}</div><div class="s">dans la page Écarts</div></div>
        <div class="tile"><div class="k">Pertes déclarées</div><div class="v">${pv.length}</div><div class="s">${aVal ? `<b style="color:var(--warn)">${aVal} à valider</b>` : 'toutes traitées'}</div></div>
      </div>
      ${recurrents.length ? `<div class="card"><h3>Écarts qui reviennent cette semaine</h3><div class="tbl"><table class="t"><thead><tr><th>Article</th><th class="n">Jours hors seuil</th><th>Détail</th></tr></thead><tbody>
        ${recurrents.map(x => `<tr><td><b>${esc(x.a.nom_court)}</b></td><td class="n">${x.jours.length}</td><td>${x.jours.map(r => `${JOURS[T().isoDow(r.d) - 1].slice(0, 3)}. ${r.e > 0 ? '+' : ''}${fr(r.e, 3)} ${U[r.article.unite]}`).join(' · ')}</td></tr>`).join('')}
        </tbody></table></div><span class="hint">Un écart identique tous les jours (variation proche de 0) est un ancien écart pas corrigé dans Bizzon. Un écart qui grossit signale une fuite en cours.</span></div>` : ''}
      <div class="sj-list">${jours.map(carteJour).join('')}</div>`;
    M.querySelector('#semPrev').onclick = () => { lundiSel = T().addDays(lun, -7); semaine(M); };
    M.querySelector('#semNext').onclick = () => { lundiSel = T().addDays(lun, 7); semaine(M); };
    M.querySelectorAll('[data-ouvre]').forEach(b => b.onclick = () => { const d = b.dataset.ouvre; ouverts.has(d) ? ouverts.delete(d) : ouverts.add(d); semaine(M); });
  }

  Object.assign(window.BarViews = window.BarViews || {}, { semaine });
})();
