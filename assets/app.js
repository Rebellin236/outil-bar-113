/* Outil Bar 1.13 — application (étape 1 : connexion, import des exports Bizzon, page « Aujourd'hui ») */
(function () {
  'use strict';
  const CFG = window.BAR_CONFIG;
  const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
    auth: { storageKey: CFG.storageKey, persistSession: true, autoRefreshToken: true }
  });
  const $ = s => document.querySelector(s);
  const app = $('#app');
  const TZ = 'Europe/Paris';
  const fr = (n, d = 2) => n === null || n === undefined ? '–' : Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: d });
  const eur = n => Number(n || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const UNIT = u => /liter/.test(u) ? 'L' : /bottle/.test(u) ? 'btl' : /kilogram/.test(u) ? 'kg' : /piece|box/.test(u) ? 'pc' : (u || '');
  const todayParis = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  const fmtDT = iso => iso ? new Date(iso).toLocaleString('fr-FR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(' ', ' à ') : '–';
  const fmtD = d => d ? new Date(d + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) : '–';

  // Heure locale de Paris "AAAA-MM-JJTHH:MM:SS" -> instant UTC (gère heure d'été / d'hiver)
  function parisToUTC(iso) {
    const guess = new Date(iso + 'Z');
    const p = new Date(guess.toLocaleString('en-US', { timeZone: TZ }));
    const u = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
    return new Date(guess.getTime() - (p - u)).toISOString();
  }

  function toast(t) { const e = $('#toast'); e.textContent = t; e.hidden = false; clearTimeout(e._t); e._t = setTimeout(() => e.hidden = true, 2600); }

  let user = null, role = null, roleName = '', selDay = null;

  /* ---------------- Connexion ---------------- */
  function renderLogin(msg) {
    app.innerHTML = `<div class="login"><form class="login-card" id="loginForm" novalidate>
      <div style="display:flex;gap:12px;align-items:center"><div class="seal">1.13</div><div><h1 style="font-size:22px">Outil Bar 1.13</h1><div class="hint">Mercure Marseille Centre Vieux-Port</div></div></div>
      ${msg ? `<div class="err">${esc(msg)}</div>` : ''}
      <div class="field"><label for="ident">Identifiant</label><input id="ident" autocomplete="username" placeholder="ton identifiant TableFlow" required></div>
      <div class="field"><label for="pass">Mot de passe</label><input id="pass" type="password" autocomplete="current-password" required></div>
      <button class="btn brass" type="submit" id="loginBtn">Se connecter</button>
      <span class="hint">Même identifiant et même mot de passe que TableFlow.</span></form></div>`;
    $('#loginForm').addEventListener('submit', async e => {
      e.preventDefault();
      const id = $('#ident').value.trim(), pw = $('#pass').value;
      if (!id || !pw) return renderLogin('Renseigne ton identifiant et ton mot de passe.');
      $('#loginBtn').disabled = true; $('#loginBtn').textContent = 'Connexion…';
      const email = id.includes('@') ? id : `${id}@${CFG.emailDomain}`;
      const { error } = await sb.auth.signInWithPassword({ email, password: pw });
      if (error) return renderLogin('Identifiant ou mot de passe incorrect.');
      boot();
    });
  }

  async function logout() { await sb.auth.signOut(); user = null; role = null; renderLogin(); }

  async function boot() {
    const { data } = await sb.auth.getSession();
    if (!data.session) return renderLogin();
    user = data.session.user;
    const { data: r, error } = await sb.rpc('bar_role');
    if (error) { app.innerHTML = `<div class="center"><div><h2>Connexion à la base impossible</h2><p class="hint">${esc(error.message)}</p><button class="btn" id="out">Se déconnecter</button></div></div>`; $('#out').onclick = logout; return; }
    role = r;
    const { data: rr } = await sb.from('bar_roles').select('nom').eq('user_id', user.id).maybeSingle();
    roleName = rr ? rr.nom : '';
    if (role === 'admin') {
      if (location.hash === '#comptage' || (window.innerWidth < 760 && location.hash !== '#poste')) return window.BarViews.phone(app);
      return renderDesk();
    }
    if (role === 'tablette') {
      app.innerHTML = `<div class="center"><div style="display:flex;flex-direction:column;gap:12px;align-items:center"><div class="seal">1.13</div><h2>Tablette du bar</h2><p class="hint">L'écran des tâches et des pertes arrive à la prochaine étape.</p><button class="btn ghost" id="out">Se déconnecter</button></div></div>`;
      $('#out').onclick = logout; return;
    }
    app.innerHTML = `<div class="center"><div style="display:flex;flex-direction:column;gap:12px;align-items:center"><h2>Accès non autorisé</h2><p class="hint">Ce compte TableFlow n'a pas accès à l'outil bar.</p><button class="btn" id="out">Se déconnecter</button></div></div>`;
    $('#out').onclick = logout;
  }

  /* ---------------- Poste (admin) ---------------- */
  const NAV = [
    ['Pilotage', [['today', "Aujourd'hui", true], ['ecarts', 'Écarts', true], ['cans', 'Canettes'], ['ventes', 'Ventes'], ['week', 'Synthèse du lundi']]],
    ['Équipe', [['pertes', 'Pertes'], ['taches', 'Tâches']]],
    ['Réglages', [['rot', 'Rotation Bar'], ['cal', 'Calendrier', true], ['seuils', 'Seuils et alertes'], ['dlc', 'Durées après ouverture']]]
  ];
  let section = 'today';
  function renderDesk(sec) {
    if (sec) section = sec;
    app.innerHTML = `<div class="desk"><nav class="side" aria-label="Sections">
      <div class="brand"><div class="seal">1.13</div><div><b>Outil Bar</b><div style="font-size:11px;opacity:.6">version 14</div></div></div>
      ${NAV.map(([g, items]) => `<div class="lbl">${g}</div>` + items.map(([k, l, on]) => `<button data-sec="${k}" ${on ? (k === section ? 'aria-current="page"' : '') : 'disabled'}><span>${l}</span>${on ? '' : '<span class="soon">bientôt</span>'}</button>`).join('')).join('')}
      <div class="who"><span>${esc(roleName || user.email)}</span><button class="btn ghost sm" id="out">Déconnexion</button></div>
    </nav><main class="main" id="main"></main></div>`;
    $('#out').onclick = logout;
    app.querySelectorAll('[data-sec]').forEach(b => { if (!b.disabled) b.onclick = () => {
      renderDesk(b.dataset.sec); }; });
    if (section === 'ecarts') return window.BarViews.ecarts($('#main'));
    if (section === 'cal') return window.BarViews.calendrier($('#main'));
    renderToday();
  }

  async function renderToday() {
    const M = $('#main');
    M.innerHTML = `<div class="main-h"><div><h2>${(d=>d.charAt(0).toUpperCase()+d.slice(1))(fmtD(todayParis()))}</h2><p>Dépose les exports Bizzon du matin, avant le comptage.</p></div></div>
      <label class="drop" id="drop" for="files"><div class="f"><b>Exports Bizzon</b><span class="hint">Glisse ici le Stock théorique et l'Analyse des ventes (fichiers Excel), ou clique pour les choisir. L'app reconnaît chaque fichier toute seule.</span></div>
      <span class="btn">Choisir les fichiers</span><input id="files" type="file" accept=".xlsx,.xls" multiple hidden></label>
      <div class="log" id="log"></div>
      <div class="imports" id="imports"></div>
      <div id="cpt"></div>
      <div id="stock"></div>
      <div id="ventes"></div>
      <div id="hist"></div>`;
    const drop = $('#drop');
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => handleFiles([...e.dataTransfer.files]));
    $('#files').addEventListener('change', e => { handleFiles([...e.target.files]); e.target.value = ''; });
    await refreshToday();
  }

  function log(msg, cls) { const d = document.createElement('div'); d.className = cls || ''; d.textContent = msg; $('#log').prepend(d); return d; }

  async function handleFiles(files) {
    for (const f of files) {
      const line = log(`Lecture de ${f.name}…`);
      try {
        const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
        const type = BarImport.detectType(wb);
        if (!type) throw new Error("Fichier non reconnu : ni Stock théorique, ni Analyse des ventes.");
        const res = type === 'stock' ? BarImport.parseStock(XLSX, wb, f.name) : BarImport.parseVentes(XLSX, wb, f.name);
        if (type === 'ventes') selDay = res.periode.debut;   // on affiche directement le jour importé
        const msg = await saveImport(res, f.name);
        line.className = 'ok'; line.textContent = msg;
      } catch (e) {
        line.className = 'bad'; line.textContent = `${f.name} : ${e.message}`;
      }
    }
    await refreshToday();
  }

  async function insertChunks(table, rows, importId) {
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500).map(r => ({ ...r, import_id: importId }));
      const { error } = await sb.from(table).insert(chunk);
      if (error) throw new Error(`Enregistrement interrompu (${error.message})`);
    }
  }

  async function saveImport(res, fichier) {
    if (res.type === 'stock') {
      if (!res.exporte) throw new Error("Heure d'export introuvable dans le fichier.");
      const exp = parisToUTC(res.exporte.iso);
      const { data: dup } = await sb.from('bar_imports').select('id').eq('type', 'stock').eq('exporte_le', exp).limit(1);
      if (dup && dup.length) return `Stock théorique exporté le ${res.exporte.affichage} : déjà importé, rien à faire.`;
      const { data: imp, error } = await sb.from('bar_imports').insert({ type: 'stock', fichier, exporte_le: exp, periode_debut: res.periode.debut, periode_fin: res.periode.fin, nb_lignes: res.lignes.length, importe_par: user.id }).select('id').single();
      if (error) throw new Error(error.message);
      try { await insertChunks('bar_stock_theo', res.lignes, imp.id); }
      catch (e) { await sb.from('bar_imports').delete().eq('id', imp.id); throw e; }
      return `Stock théorique exporté le ${res.exporte.affichage} : ${res.lignes.length} articles de l'Économat importés.`;
    }
    // Ventes : pour chaque jour, seul le dernier import compte. Un fichier réimporté sous le même nom remplace l'ancien en entier.
    const { data: old } = await sb.from('bar_imports').select('id').eq('type', 'ventes').eq('fichier', fichier);
    const { data: imp, error } = await sb.from('bar_imports').insert({ type: 'ventes', fichier, periode_debut: res.periode.debut, periode_fin: res.periode.fin, nb_lignes: res.lignes.length, importe_par: user.id }).select('id').single();
    if (error) throw new Error(error.message);
    try { await insertChunks('bar_ventes', res.lignes, imp.id); }
    catch (e) { await sb.from('bar_imports').delete().eq('id', imp.id); throw e; }
    if (old && old.length) await sb.from('bar_imports').delete().in('id', old.map(o => o.id));
    // Nettoyage : les anciens imports sur plusieurs jours sont faux par construction (voir import.js)
    const { data: multi } = await sb.from('bar_imports').select('id,periode_debut,periode_fin').eq('type', 'ventes');
    const bad = (multi || []).filter(m => m.periode_debut !== m.periode_fin).map(m => m.id);
    if (bad.length) await sb.from('bar_imports').delete().in('id', bad);
    await sb.from('bar_ventes').delete().gte('date_vente', res.periode.debut).lte('date_vente', res.periode.fin).neq('import_id', imp.id);
    const per = res.periode.debut === res.periode.fin ? `du ${fmtD(res.periode.debut)}` : `du ${res.periode.debut} au ${res.periode.fin}`;
    return `Ventes ${per} : ${res.lignes.length} lignes importées${old && old.length ? ' (import précédent remplacé)' : ''}.`;
  }

  async function refreshToday() {
    const [{ data: lastStock }, { data: lastVentes }, { data: arts }, { data: regl }] = await Promise.all([
      sb.from('bar_imports').select('*').eq('type', 'stock').order('exporte_le', { ascending: false }).limit(1),
      sb.from('bar_imports').select('*').eq('type', 'ventes').order('periode_fin', { ascending: false }).order('importe_le', { ascending: false }).limit(1),
      sb.from('bar_articles').select('*').eq('actif', true).order('type').order('ordre'),
      sb.from('bar_reglages').select('*')
    ]);
    const st = lastStock && lastStock[0], ve = lastVentes && lastVentes[0];
    renderHist();
    window.BarViews.statutDuJour($('#cpt'), () => renderDesk('ecarts'));
    const R = Object.fromEntries((regl || []).map(r => [r.cle, r.valeur]));
    const today = todayParis();
    const stToday = st && new Date(st.exporte_le).toLocaleDateString('en-CA', { timeZone: TZ }) === today;
    $('#imports').innerHTML = `
      <div class="imp ${st ? (stToday ? 'ok' : 'old') : ''}"><span class="dot"></span><div><div class="k">Stock théorique</div><div class="hint">${st ? `Exporté le ${fmtDT(st.exporte_le)} · ${st.nb_lignes} articles${stToday ? '' : ' · <b>pas celui d’aujourd’hui</b>'}` : 'Aucun import pour l’instant'}</div></div></div>
      <div class="imp ${ve ? 'ok' : ''}"><span class="dot"></span><div><div class="k">Analyse des ventes</div><div class="hint">${ve ? `Ventes ${ve.periode_debut === ve.periode_fin ? 'du ' + fmtD(ve.periode_debut) : 'du ' + ve.periode_debut + ' au ' + ve.periode_fin} · ${ve.nb_lignes} lignes` : 'Aucun import pour l’instant'}</div></div></div>`;

    // Articles suivis : théorique du dernier import
    if (!st) { $('#stock').innerHTML = `<div class="empty">Importe un Stock théorique pour voir le stock des articles suivis.</div>`; }
    else {
      const noms = (arts || []).map(a => a.nom_bizzon);
      const { data: lignes } = await sb.from('bar_stock_theo').select('nom_bizzon,unite,prevu,prix,valeur,vendu,transferts').eq('import_id', st.id).in('nom_bizzon', noms);
      const byN = Object.fromEntries((lignes || []).map(l => [l.nom_bizzon, l]));
      const groups = [['prioritaire', 'Bar · liste prioritaire'], ['canette', 'Canettes · comptées tous les jours']];
      const missing = (arts || []).filter(a => !byN[a.nom_bizzon]);
      $('#stock').innerHTML = `<div class="card"><div class="main-h" style="align-items:center"><h3>Articles suivis · stock théorique Économat</h3><span class="hint">référence : export du ${fmtDT(st.exporte_le)}</span></div>
        ${missing.length ? `<div class="err" style="background:var(--warn-soft);color:var(--warn)">${missing.length} article${missing.length > 1 ? 's' : ''} introuvable${missing.length > 1 ? 's' : ''} dans l'export : ${missing.map(m => esc(m.nom_court)).join(', ')}. Le nom a peut-être changé dans Bizzon.</div>` : ''}
        <div class="tbl"><table class="t"><thead><tr><th>Article</th><th class="n">Théorique</th><th class="n">Prix unitaire</th><th class="n">Valeur</th><th class="n">Vendu (période de l'export)</th><th>Fréquence</th></tr></thead><tbody>
        ${groups.map(([g, lbl]) => `<tr class="grp"><td colspan="6">${lbl}</td></tr>` + (arts || []).filter(a => a.type === g).map(a => {
          const l = byN[a.nom_bizzon];
          return `<tr><td>${esc(a.nom_court)}</td>${l ? `<td class="n">${fr(l.prevu, 3)} ${UNIT(l.unite)}</td><td class="n">${eur(l.prix)}</td><td class="n">${eur(l.valeur)}</td><td class="n">${fr(l.vendu, 3)}</td>` : '<td colspan="4"><span class="pill p-warn">introuvable dans l’export</span></td>'}<td>${a.type === 'canette' ? 'tous les jours' : a.freq_semaine + ' fois / semaine'}</td></tr>`;
        }).join('')).join('')}
        </tbody></table></div></div>`;
    }

    // Ventes : navigation jour par jour sur tout l'historique importé
    renderVentes(R, today);
  }

  async function renderVentes(R, today) {
    const box = $('#ventes'); if (!box) return;
    const { data: imps } = await sb.from('bar_imports').select('periode_debut').eq('type', 'ventes').order('periode_debut', { ascending: false }).limit(400);
    const days = [...new Set((imps || []).map(i => i.periode_debut).filter(Boolean))].sort();
    if (!days.length) { box.innerHTML = `<div class="empty">Importe une Analyse des ventes pour voir le rapport de la veille.</div>`; return; }
    const hier = new Date(Date.parse(today + 'T12:00:00Z') - 864e5).toISOString().slice(0, 10);
    if (!selDay || !days.includes(selDay)) selDay = days.includes(today) ? today : days[days.length - 1];   // à l'ouverture : le jour même s'il est importé, sinon le plus récent
    const idx = days.indexOf(selDay);
    const last7 = days.slice(-7);
    const prevWeek = new Date(Date.parse(selDay + 'T12:00:00Z') - 7 * 864e5).toISOString().slice(0, 10);
    const want = [...new Set([...last7, selDay, prevWeek])];
    const { data: vl } = await sb.from('bar_ventes').select('date_vente,article,centre,point_vente,quantite,net_ht').in('date_vente', want).limit(20000);
    const PV = [['BAR 1.13', 'Bar 1.13'], ['RESTAURANT 1.13', 'Restaurant 1.13'], ['M SHOP', 'Mshop']];
    const synDay = d => BarImport.syntheseVentes((vl || []).filter(l => l.date_vente === d), R.exclusions_ventes);
    const tot = (syn, k) => syn.parPV[k] ? syn.parPV[k].total : 0;
    const t3 = sy => PV.reduce((s, p) => s + tot(sy, p[0]), 0);
    const syn = synDay(selDay), synPW = days.includes(prevWeek) ? synDay(prevWeek) : null;
    const evol = (a, b) => b ? `${a >= b ? '+' : ''}${fr((a - b) / b * 100, 1)} % vs ${fmtD(prevWeek).split(' ')[0]} précédent` : '';
    const others = Object.keys(syn.parPV).filter(k => !PV.some(p => p[0] === k));
    const bar = syn.parPV['BAR 1.13'];
    const top = bar ? Object.entries(bar.articles).sort((a, b) => b[1].net - a[1].net).slice(0, 8) : [];
    const maxTop = top.length ? top[0][1].net : 1;
    const cap = d => { const x = fmtD(d); return x.charAt(0).toUpperCase() + x.slice(1); };
    const missing = [];
    for (let k = 7; k >= 1; k--) { const d = new Date(Date.parse(today + 'T12:00:00Z') - k * 864e5).toISOString().slice(0, 10); if (!days.includes(d)) missing.push(d); }
    const allArts = PV.map(([k, l]) => { const p = syn.parPV[k]; const rows = p ? Object.entries(p.articles).sort((a, b) => b[1].net - a[1].net) : [];
      return `<details class="arts" ${k === 'BAR 1.13' ? 'open' : ''}><summary><b>${l}</b><span class="hint">${rows.length} article${rows.length > 1 ? 's' : ''} · ${eur(p ? p.total : 0)}</span></summary>
        ${rows.length ? `<div class="tbl"><table class="t"><thead><tr><th>Article vendu</th><th class="n">Quantité</th><th class="n">CA HT</th><th class="n">Part</th></tr></thead><tbody>
        ${rows.map(([n, a]) => `<tr><td>${esc(n)}</td><td class="n">${fr(a.q)}</td><td class="n">${eur(a.net)}</td><td class="n">${p.total ? fr(a.net / p.total * 100, 1) + ' %' : '–'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="hint" style="margin:8px 0">Aucune vente.</p>'}</details>`; }).join('');
    box.innerHTML = `<div class="card">
      <div class="main-h" style="align-items:center"><h3>Ventes</h3><span class="hint">CA net HT · hors petit-déjeuner et banquet</span></div>
      ${missing.length ? `<div class="err" style="background:var(--warn-soft);color:var(--warn)"><b>Ventes manquantes :</b> ${missing.map(cap).join(', ')}. Exporte chacun de ces jours (date de début = le jour, date de fin = le lendemain) et glisse les fichiers ensemble.</div>` : ''}
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="btn ghost sm" id="dPrev" ${idx <= 0 ? 'disabled' : ''} aria-label="Jour précédent">‹ Jour précédent</button>
        <select id="dSel" aria-label="Choisir le jour" style="font:inherit;font-weight:700;padding:8px 10px;border:1.5px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink)">
          ${days.slice().reverse().map(d => `<option value="${d}" ${d === selDay ? 'selected' : ''}>${cap(d)}</option>`).join('')}</select>
        <button class="btn ghost sm" id="dNext" ${idx >= days.length - 1 ? 'disabled' : ''} aria-label="Jour suivant">Jour suivant ›</button>
        ${selDay === today ? '<span class="pill p-ok">aujourd’hui</span>' : selDay === hier ? '<span class="pill p-ok">hier</span>' : ''}
      </div>
      <div class="tiles">${PV.map(([k, l]) => { const p = syn.parPV[k]; const v = p ? p.total : 0; const pw = synPW ? tot(synPW, k) : null;
        return `<div class="tile"><div class="k">${l}</div><div class="v">${eur(v)}</div><div class="s">${p ? Object.entries(p.centres).sort((a, b) => b[1] - a[1]).map(([c, x]) => `${esc(c.toLowerCase())} ${eur(x)}`).join(' · ') : 'aucune vente encaissée'}</div>${pw ? `<div class="s">${evol(v, pw)}</div>` : ''}</div>`; }).join('')}
        <div class="tile"><div class="k">Total des trois</div><div class="v">${eur(t3(syn))}</div>${synPW ? `<div class="s">${evol(t3(syn), t3(synPW))}</div>` : '<div class="s">comparaison dès qu\'il y a une semaine d\'historique</div>'}</div></div>
      ${others.length ? `<span class="hint">Autres points de vente : ${others.map(k => `${esc(k)} ${eur(syn.parPV[k].total)}`).join(' · ')}</span>` : ''}
      <span class="hint">Hors périmètre : ${Object.entries(syn.horsPerimetre).map(([k, v]) => `${esc(k.toLowerCase())} ${eur(v)}`).join(' · ') || 'rien'}.</span>
      ${top.length ? `<h3 style="margin-top:4px">Bar · articles les plus vendus</h3><div class="bars">${top.map(([n, a]) => `<div class="barrow"><span>${esc(n)}</span><div class="track"><i style="width:${Math.max(2, a.net / maxTop * 100)}%"></i></div><span class="v">${fr(a.q)} · ${eur(a.net)}</span></div>`).join('')}</div>` : ''}
      <h3 style="margin-top:6px">Tous les articles vendus · ${cap(selDay)}</h3>${allArts}
      ${last7.length > 1 ? `<h3 style="margin-top:6px">Les ${last7.length} derniers jours importés · clique sur un jour pour le détail</h3><div class="tbl"><table class="t"><thead><tr><th>Jour</th>${PV.map(p => `<th class="n">${p[1]}</th>`).join('')}<th class="n">Total des trois</th></tr></thead><tbody>
        ${last7.slice().reverse().map(d => { const sy = synDay(d); return `<tr data-day="${d}" style="cursor:pointer${d === selDay ? ';background:var(--brass-soft)' : ''}"><td>${cap(d)}</td>${PV.map(p => `<td class="n">${eur(tot(sy, p[0]))}</td>`).join('')}<td class="n"><b>${eur(t3(sy))}</b></td></tr>`; }).join('')}
      </tbody></table></div>` : ''}
    </div>`;
    const go = d => { selDay = d; renderVentes(R, today); };
    $('#dPrev').onclick = () => go(days[idx - 1]);
    $('#dNext').onclick = () => go(days[idx + 1]);
    $('#dSel').onchange = e => go(e.target.value);
    box.querySelectorAll('tr[data-day]').forEach(tr => tr.onclick = () => go(tr.dataset.day));
  }

  async function renderHist() {
    const { data: imps } = await sb.from('bar_imports').select('*').order('importe_le', { ascending: false }).limit(20);
    const el = $('#hist'); if (!el) return;
    if (!imps || !imps.length) { el.innerHTML = ''; return; }
    el.innerHTML = `<div class="card"><h3>Historique des imports</h3><div class="tbl"><table class="t"><thead><tr><th>Type</th><th>Contenu</th><th class="n">Lignes</th><th>Fichier</th><th>Importé le</th><th></th></tr></thead><tbody>
      ${imps.map(i => `<tr><td>${i.type === 'stock' ? 'Stock théorique' : 'Ventes'}</td>
        <td>${i.type === 'stock' ? 'exporté le ' + fmtDT(i.exporte_le) : (i.periode_debut === i.periode_fin ? fmtD(i.periode_debut) : `<span class="pill p-bad">plusieurs jours : faux</span> ${i.periode_debut} → ${i.periode_fin}`)}</td>
        <td class="n">${i.nb_lignes ?? '–'}</td><td class="hint">${esc(i.fichier || '')}</td><td>${fmtDT(i.importe_le)}</td>
        <td><button class="btn ghost sm" data-del="${i.id}">Supprimer</button></td></tr>`).join('')}
      </tbody></table></div><span class="hint">Supprimer un import efface aussi toutes ses lignes. Tu peux ensuite réimporter le bon fichier.</span></div>`;
    el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Confirmer la suppression'; b.classList.remove('ghost'); b.style.background = 'var(--bad)'; b.style.color = '#fff'; setTimeout(() => { if (b.isConnected && b.dataset.armed === '1') { b.dataset.armed = ''; b.textContent = 'Supprimer'; b.classList.add('ghost'); b.style.background = ''; b.style.color = ''; } }, 4000); return; }
      b.disabled = true;
      const { error } = await sb.from('bar_imports').delete().eq('id', b.dataset.del);
      if (error) { toast('Suppression impossible : ' + error.message); b.disabled = false; return; }
      toast('Import supprimé'); refreshToday();
    });
  }

  window.BarCtx = { sb, $, fr, eur, esc, fmtD, fmtDT, todayParis, TZ, toast, user: () => user, roleName: () => roleName,
    poste: () => { location.hash = 'poste'; renderDesk(); }, logout };
  sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') renderLogin(); });
  boot();
})();
