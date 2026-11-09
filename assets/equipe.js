/* Outil Bar 1.13 — ordinateur : pertes (validation, récap mensuel pour Bizzon) et tâches (suivi, équipe, codes) */
(function () {
  'use strict';
  const C = () => window.BarCtx;
  const T = () => window.BarTirage;
  const uniteBizzon = u => /liter/.test(u || '') ? 'L' : /bottle/.test(u || '') ? 'btl' : /kilogram/.test(u || '') ? 'kg' : 'pc';
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const moisDe = iso => new Date(iso).toLocaleDateString('en-CA', { timeZone: C().TZ }).slice(0, 7);
  const nomMois = m => cap(new Date(m + '-15T12:00:00Z').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }));

  async function prixActuels(noms) {
    const { sb } = C();
    if (!noms.length) return {};
    const { data: imp } = await sb.from('bar_imports').select('id').eq('type', 'stock').order('exporte_le', { ascending: false }).limit(1);
    if (!imp || !imp[0]) return {};
    const { data } = await sb.from('bar_stock_theo').select('nom_bizzon,prix,unite').eq('import_id', imp[0].id).in('nom_bizzon', [...new Set(noms)]);
    return Object.fromEntries((data || []).map(l => [l.nom_bizzon, l]));
  }

  /* ================= Pertes ================= */
  let ongletP = 'avalider', moisSel = null;
  async function pertes(M) {
    const { sb, esc, fr, eur, fmtDT, todayParis, toast } = C();
    M.innerHTML = '<div class="hint">Chargement des pertes…</div>';
    const depuis = new Date(Date.now() - 400 * 864e5).toISOString();
    const { data: rows, error } = await sb.from('bar_pertes').select('*, staff:bar_staff(prenom)').gte('cree_le', depuis).order('cree_le', { ascending: false });
    if (error) { M.innerHTML = `<div class="empty">Pertes indisponibles : ${esc(error.message)}</div>`; return; }
    const prix = await prixActuels((rows || []).map(r => r.nom_bizzon));
    const val = r => prix[r.nom_bizzon] ? Number(r.quantite) * Number(prix[r.nom_bizzon].prix) : null;
    const un = r => prix[r.nom_bizzon] ? uniteBizzon(prix[r.nom_bizzon].unite) : '';
    const aVal = rows.filter(r => r.statut === 'a_valider');
    const mois = [...new Set(rows.map(r => moisDe(r.cree_le)).concat([todayParis().slice(0, 7)]))].sort().reverse();
    if (!moisSel || !mois.includes(moisSel)) moisSel = mois[0];
    const qui = r => esc(r.staff ? r.staff.prenom : 'Admin');
    const tabs = `<div class="seg" role="tablist">${[['avalider', `À valider${aVal.length ? ` <i>${aVal.length}</i>` : ''}`], ['recap', 'Récap du mois pour Bizzon'], ['histo', 'Historique']].map(([k, l]) => `<button role="tab" data-o="${k}" aria-selected="${ongletP === k}">${l}</button>`).join('')}</div>`;
    let corps = '';
    if (ongletP === 'avalider') {
      corps = aVal.length ? `<div class="tbl"><table class="t"><thead><tr><th>Déclarée</th><th>Par</th><th>Article</th><th class="n">Quantité</th><th>Motif</th><th>Commentaire</th><th class="n">Valeur</th><th></th></tr></thead><tbody>
        ${aVal.map(r => `<tr><td>${fmtDT(r.cree_le)}</td><td>${qui(r)}</td><td>${esc(r.nom_bizzon)}</td><td class="n">${fr(r.quantite, 3)} ${un(r)}</td><td>${esc(r.motif)}</td><td class="hint">${esc(r.commentaire || '')}</td><td class="n">${val(r) === null ? '–' : eur(val(r))}</td>
        <td style="white-space:nowrap"><button class="btn sm" data-ok="${r.id}">Valider</button> <button class="btn ghost sm" data-ko="${r.id}">Refuser</button></td></tr>`).join('')}
        </tbody></table></div>${aVal.length > 1 ? '<button class="btn" id="toutVal" style="align-self:flex-start">Tout valider</button>' : ''}
        <span class="hint">Une perte validée est déduite du théorique dans le calcul des écarts jusqu'à son transfert dans Bizzon. Une perte refusée n'est pas prise en compte.</span>`
        : '<div class="empty">Aucune perte à valider.</div>';
    } else if (ongletP === 'recap') {
      const duMois = rows.filter(r => r.statut === 'validee' && moisDe(r.cree_le) === moisSel);
      const aReporter = duMois.filter(r => !r.reporte_bizzon), reportees = duMois.filter(r => r.reporte_bizzon);
      const grp = list => { const g = {}; list.forEach(r => { const k = r.nom_bizzon; g[k] = g[k] || { nom: k, q: 0, v: 0, n: 0, sansPrix: false, u: un(r) }; g[k].q += Number(r.quantite); g[k].n++; const v = val(r); if (v === null) g[k].sansPrix = true; else g[k].v += v; }); return Object.values(g).sort((a, b) => b.v - a.v); };
      const g = grp(aReporter), tot = g.reduce((s, x) => s + x.v, 0);
      corps = `<div class="main-h" style="align-items:center"><select id="moisSel" class="sel">${mois.map(m => `<option value="${m}" ${m === moisSel ? 'selected' : ''}>${nomMois(m)}</option>`).join('')}</select>
          <div style="display:flex;gap:8px">${g.length ? '<button class="btn ghost" id="xls">Télécharger en Excel</button><button class="btn brass" id="report">Marquer comme transférées dans Bizzon</button>' : ''}</div></div>
        <div class="tiles"><div class="tile"><div class="k">À transférer dans Bizzon</div><div class="v">${eur(tot)}</div><div class="s">${aReporter.length} perte${aReporter.length > 1 ? 's' : ''} validée${aReporter.length > 1 ? 's' : ''}, ${g.length} article${g.length > 1 ? 's' : ''}</div></div>
          <div class="tile"><div class="k">Déjà transférées</div><div class="v">${eur(reportees.reduce((s, r) => s + (val(r) || 0), 0))}</div><div class="s">${reportees.length} perte${reportees.length > 1 ? 's' : ''}</div></div>
          <div class="tile"><div class="k">Encore à valider</div><div class="v ${aVal.filter(r => moisDe(r.cree_le) === moisSel).length ? 'neg' : ''}">${aVal.filter(r => moisDe(r.cree_le) === moisSel).length}</div><div class="s">à traiter avant le transfert</div></div></div>
        ${g.length ? `<div class="tbl"><table class="t"><thead><tr><th>Article (nom Bizzon)</th><th class="n">Quantité à transférer</th><th class="n">Déclarations</th><th class="n">Valeur</th></tr></thead><tbody>
          ${g.map(x => `<tr><td>${esc(x.nom)}</td><td class="n"><b>${fr(x.q, 3)}</b> ${x.u}</td><td class="n">${x.n}</td><td class="n">${x.sansPrix ? '<span class="pill p-warn">prix absent</span>' : eur(x.v)}</td></tr>`).join('')}
          </tbody></table></div>
          <span class="hint">Dans Bizzon : transfert du dépôt ECONOMAT GENERAL vers PERTE ET CASSE, une ligne par article, avec la quantité ci-dessus. Puis clique sur « Marquer comme transférées » : les écarts cessent alors de déduire ces pertes, puisque Bizzon les a déjà sorties du théorique. Valeurs au prix unitaire du dernier stock importé.</span>`
          : '<div class="empty">Rien à transférer pour ce mois.</div>'}`;
      S.recap = { aReporter, g };
    } else {
      corps = `<div class="tbl"><table class="t"><thead><tr><th>Déclarée</th><th>Par</th><th>Article</th><th class="n">Quantité</th><th>Motif</th><th class="n">Valeur</th><th>Statut</th></tr></thead><tbody>
        ${rows.slice(0, 300).map(r => `<tr><td>${fmtDT(r.cree_le)}</td><td>${qui(r)}</td><td>${esc(r.nom_bizzon)}${r.commentaire ? `<div class="hint">${esc(r.commentaire)}</div>` : ''}</td><td class="n">${fr(r.quantite, 3)} ${un(r)}</td><td>${esc(r.motif)}</td><td class="n">${val(r) === null ? '–' : eur(val(r))}</td>
        <td>${r.statut === 'a_valider' ? '<span class="pill p-warn">À valider</span>' : r.statut === 'refusee' ? '<span class="pill p-mute">Refusée</span>' : r.reporte_bizzon ? `<span class="pill p-ok">Transférée le ${C().fmtD(r.reporte_bizzon).replace(/^\w+ /, '')}</span>` : '<span class="pill p-ok">Validée</span>'}</td></tr>`).join('') || '<tr><td colspan="7" class="hint">Aucune perte déclarée.</td></tr>'}
        </tbody></table></div>`;
    }
    M.innerHTML = `<div class="main-h"><div><h2>Pertes</h2><p>Déclarées par l'équipe sur la tablette avec leur code. Tu valides, puis tu transfères le récap du mois dans Bizzon.</p></div></div>${tabs}${corps}`;
    M.querySelectorAll('[data-o]').forEach(b => b.onclick = () => { ongletP = b.dataset.o; pertes(M); });
    const traiter = async (ids, statut) => {
      const { error: e } = await sb.from('bar_pertes').update({ statut, traite_par: C().user().id, traite_le: new Date().toISOString() }).in('id', ids);
      toast(e ? 'Non enregistré : ' + e.message : statut === 'validee' ? `${ids.length} perte${ids.length > 1 ? 's' : ''} validée${ids.length > 1 ? 's' : ''}` : 'Perte refusée');
      pertes(M);
    };
    M.querySelectorAll('[data-ok]').forEach(b => b.onclick = () => traiter([+b.dataset.ok], 'validee'));
    M.querySelectorAll('[data-ko]').forEach(b => b.onclick = () => traiter([+b.dataset.ko], 'refusee'));
    const tv = M.querySelector('#toutVal'); if (tv) tv.onclick = () => traiter(aVal.map(r => r.id), 'validee');
    const ms = M.querySelector('#moisSel'); if (ms) ms.onchange = () => { moisSel = ms.value; pertes(M); };
    const x = M.querySelector('#xls'); if (x) x.onclick = () => {
      const ws = window.XLSX.utils.aoa_to_sheet([['Article (nom Bizzon)', 'Quantité', 'Unité', 'Déclarations', 'Valeur (€)']].concat(S.recap.g.map(g => [g.nom, +g.q.toFixed(3), g.u, g.n, g.sansPrix ? '' : +g.v.toFixed(2)])));
      ws['!cols'] = [{ wch: 44 }, { wch: 10 }, { wch: 7 }, { wch: 12 }, { wch: 11 }];
      const wb = window.XLSX.utils.book_new(); window.XLSX.utils.book_append_sheet(wb, ws, 'Pertes ' + moisSel);
      window.XLSX.writeFile(wb, `Pertes_Bar113_${moisSel}.xlsx`);
    };
    const rp = M.querySelector('#report'); if (rp) rp.onclick = async () => {
      if (!rp.dataset.sure) { rp.dataset.sure = '1'; rp.textContent = 'Confirmer : saisi dans Bizzon ?'; setTimeout(() => { if (rp.isConnected) { delete rp.dataset.sure; rp.textContent = 'Marquer comme transférées dans Bizzon'; } }, 5000); return; }
      const { error: e } = await sb.from('bar_pertes').update({ reporte_bizzon: todayParis() }).in('id', S.recap.aReporter.map(r => r.id));
      toast(e ? 'Non enregistré : ' + e.message : 'Pertes marquées comme transférées dans Bizzon'); pertes(M);
    };
  }
  const S = {};

  /* ================= Tâches ================= */
  async function taches(M) {
    const { sb, esc, todayParis, toast, fmtD } = C();
    M.innerHTML = '<div class="hint">Chargement des tâches…</div>';
    const today = todayParis(), debut = T().addDays(today, -6);
    const [{ data: tks }, { data: vals }, { data: staff }] = await Promise.all([
      sb.from('bar_taches').select('*').eq('actif', true).order('ordre'),
      sb.from('bar_taches_validations').select('*, staff:bar_staff(prenom)').gte('date_jour', T().addDays(T().lundi(today), -7)),
      sb.rpc('bar_staff_liste')]);
    const lancement = (vals || []).reduce((m, x) => !m || x.date_jour < m ? x.date_jour : m, null) || today; // avant le premier usage : pas de rouge
    const jours = Array.from({ length: 7 }, (_, i) => T().addDays(debut, i));
    const v = {}; (vals || []).forEach(x => v[x.tache_id + '|' + x.date_jour] = x);
    const now = new Date().toLocaleTimeString('fr-FR', { timeZone: C().TZ, hour: '2-digit', minute: '2-digit' });
    const cell = (t, d) => { const x = v[t.id + '|' + d];
      if (x) return `<td class="tc ok" title="${esc(x.staff ? x.staff.prenom : '')} · ${new Date(x.valide_le).toLocaleTimeString('fr-FR', { timeZone: C().TZ, hour: '2-digit', minute: '2-digit' })}">✓<small>${esc(x.staff ? x.staff.prenom : 'admin')}</small></td>`;
      if (d < lancement) return '<td class="tc wait">–</td>';
      const enCours = d === today && t.heure_limite.slice(0, 5) >= now;
      return `<td class="tc ${enCours ? 'wait' : 'ko'}">${enCours ? 'avant ' + t.heure_limite.slice(0, 5).replace(':', 'h') : '✗'}</td>`; };
    const quo = (tks || []).filter(t => t.frequence === 'quotidienne'), heb = (tks || []).filter(t => t.frequence === 'hebdomadaire');
    const manquees = quo.reduce((s, t) => s + jours.filter(d => d >= lancement && !v[t.id + '|' + d] && !(d === today && t.heure_limite.slice(0, 5) >= now)).length, 0);
    const semaines = [T().addDays(T().lundi(today), -7), T().lundi(today)];
    M.innerHTML = `<div class="main-h"><div><h2>Tâches</h2><p>Validées sur la tablette du bar avec le code personnel. Une tâche non validée à l'heure limite apparaît en rouge.</p></div></div>
      <div class="tiles"><div class="tile"><div class="k">Aujourd'hui</div><div class="v">${quo.filter(t => v[t.id + '|' + today]).length}/${quo.length}</div><div class="s">tâches quotidiennes faites</div></div>
        <div class="tile"><div class="k">Non faites sur 7 jours</div><div class="v ${manquees ? 'neg' : ''}">${manquees}</div><div class="s">heure limite dépassée sans validation</div></div></div>
      <div class="card"><h3>Tâches quotidiennes · 7 derniers jours</h3><div class="tbl"><table class="t tgrid"><thead><tr><th>Tâche</th><th>Limite</th>${jours.map(d => `<th class="tc">${fmtD(d).slice(0, 3)}. ${Number(d.slice(8))}</th>`).join('')}</tr></thead><tbody>
        ${quo.map(t => `<tr><td>${esc(t.libelle)}</td><td class="hint">${t.heure_limite.slice(0, 5).replace(':', 'h')}</td>${jours.map(d => cell(t, d)).join('')}</tr>`).join('')}</tbody></table></div></div>
      <div class="card"><h3>Tâches hebdomadaires</h3><div class="tbl"><table class="t tgrid"><thead><tr><th>Tâche</th><th>Jour</th>${semaines.map(l => `<th class="tc">Sem. du ${Number(l.slice(8))}/${l.slice(5, 7)}</th>`).join('')}</tr></thead><tbody>
        ${heb.map(t => `<tr><td>${esc(t.libelle)}</td><td class="hint">${['', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'][t.jour_semaine]}</td>${semaines.map(l => { const d = T().addDays(l, t.jour_semaine - 1); return d > today ? '<td class="tc wait">à venir</td>' : cell(t, d); }).join('')}</tr>`).join('')}</tbody></table></div></div>
      <div class="card"><div class="main-h" style="align-items:center"><h3>Équipe du bar et codes</h3><span class="hint">Chaque personne crée son code sur la tablette (« Première fois ? Créer mon code »).</span></div>
        <div class="tbl"><table class="t"><thead><tr><th>Prénom</th><th>Code</th><th></th></tr></thead><tbody>
        ${(staff || []).map(s => `<tr><td>${esc(s.prenom)}</td><td>${s.a_un_code ? '<span class="pill p-ok">Créé</span>' : '<span class="pill p-mute">Pas encore créé</span>'}</td>
          <td style="text-align:right;white-space:nowrap">${s.a_un_code ? `<button class="btn ghost sm" data-reset="${s.id}">Réinitialiser le code</button>` : ''} <button class="btn ghost sm" data-off="${s.id}">Retirer de l'équipe</button></td></tr>`).join('')}
        </tbody></table></div>
        <div style="display:flex;gap:8px;align-items:center"><input id="nvPrenom" class="sel" placeholder="Prénom" maxlength="30" style="font-weight:500"><button class="btn sm" id="ajout">Ajouter à l'équipe</button></div></div>`;
    const deux = (b, label, fn) => b.onclick = async () => { if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = label; setTimeout(() => { if (b.isConnected) taches(M); }, 4000); return; } await fn(); };
    M.querySelectorAll('[data-reset]').forEach(b => deux(b, 'Confirmer la réinitialisation', async () => {
      const { error } = await sb.from('bar_staff').update({ pin_hash: null }).eq('id', +b.dataset.reset);
      toast(error ? error.message : 'Code réinitialisé : la personne en recrée un sur la tablette'); taches(M); }));
    M.querySelectorAll('[data-off]').forEach(b => deux(b, 'Confirmer le retrait', async () => {
      const { error } = await sb.from('bar_staff').update({ actif: false, pin_hash: null }).eq('id', +b.dataset.off);
      toast(error ? error.message : 'Retiré de l’équipe (son historique est conservé)'); taches(M); }));
    M.querySelector('#ajout').onclick = async () => {
      const p = M.querySelector('#nvPrenom').value.trim(); if (!p) return;
      const { error } = await sb.from('bar_staff').upsert({ prenom: p, actif: true }, { onConflict: 'prenom' });
      toast(error ? error.message : `${p} ajouté(e) à l'équipe`); taches(M);
    };
  }

  Object.assign(window.BarViews = window.BarViews || {}, { pertes, taches });
})();
