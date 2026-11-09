/* Outil Bar 1.13 — tablette du bar : tâches du jour, tâches de la semaine, déclaration de pertes.
   Chaque action est signée avec le code personnel à 4 chiffres, vérifié côté serveur. */
(function () {
  'use strict';
  const C = () => window.BarCtx;
  const MOTIFS = ['Casse', 'Périmé ou abîmé', 'Erreur de préparation', 'Retour client', 'Autre'];
  const MOMENTS = { ouverture: 'Ouverture', midi: 'Midi', soir: 'Soir', fermeture: 'Fermeture' };
  const JOURS = ['', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
  const uniteBizzon = u => /liter/.test(u || '') ? 'L' : /bottle/.test(u || '') ? 'bouteille' : /kilogram/.test(u || '') ? 'kg' : /box/.test(u || '') ? 'boîte' : 'pièce';
  let S = { onglet: 'jour', taches: [], perte: null, timer: null };

  function heureParis() { return Number(new Date().toLocaleString('en-GB', { timeZone: C().TZ, hour: '2-digit', hour12: false })); }
  function hhmmParis() { return new Date().toLocaleTimeString('fr-FR', { timeZone: C().TZ, hour: '2-digit', minute: '2-digit' }); }

  async function tablette(app) {
    S.app = app;
    await charger();
    draw();
    clearInterval(S.timer);
    S.timer = setInterval(async () => { if (!document.querySelector('.pin-ov')) { await charger(); draw(); } }, 120000); // rafraîchit toutes les 2 min
  }
  async function charger() {
    const { data, error } = await C().sb.rpc('bar_taches_du_jour');
    if (error) { C().toast('Tâches indisponibles : ' + error.message); S.taches = []; return; }
    S.taches = data || [];
  }

  function draw() {
    const { esc, fmtD, todayParis } = C();
    const nuit = heureParis() >= 19 || heureParis() < 7;
    const jour = S.taches.filter(t => t.frequence === 'quotidienne'), sem = S.taches.filter(t => t.frequence === 'hebdomadaire');
    const faites = jour.filter(t => t.fait_le).length;
    const now = hhmmParis();
    const enRetard = t => !t.fait_le && t.heure_limite.slice(0, 5) < now;
    const ligne = t => `<li class="tk ${t.fait_le ? 'done' : enRetard(t) ? 'late' : ''}">
        <div class="tk-txt"><b>${esc(t.libelle)}</b>${t.detail ? `<span>${esc(t.detail)}</span>` : ''}
        <small>${t.fait_le ? `Fait par ${esc(t.fait_par || '')} à ${new Date(t.fait_le).toLocaleTimeString('fr-FR', { timeZone: C().TZ, hour: '2-digit', minute: '2-digit' })}` : `Avant ${t.heure_limite.slice(0, 5).replace(':', 'h')}${enRetard(t) ? ' · en retard' : ''}`}</small></div>
        ${t.fait_le ? '<span class="tk-ok" aria-label="Fait">✓</span>' : `<button class="btn" data-tache="${t.id}">Valider</button>`}</li>`;
    let corps;
    if (S.onglet === 'jour') {
      corps = Object.keys(MOMENTS).map(m => { const l = jour.filter(t => t.moment === m); return l.length ? `<section class="tk-g"><h3>${MOMENTS[m]}</h3><ul>${l.map(ligne).join('')}</ul></section>` : ''; }).join('');
    } else if (S.onglet === 'semaine') {
      const auj = window.BarTirage.isoDow(todayParis());
      corps = `<section class="tk-g"><ul>${sem.map(t => ligne(t).replace('<div class="tk-txt"><b>', `<div class="tk-txt"><em class="${t.jour_semaine === auj ? 'auj' : ''}">${JOURS[t.jour_semaine]}${t.jour_semaine === auj ? ' · aujourd’hui' : ''}</em><b>`)).join('')}</ul></section>`;
    } else corps = formPerte();
    S.app.innerHTML = `<div class="tb ${nuit ? 'nuit' : ''}"><header class="tb-h"><div><h2>Bar 1.13</h2><p>${(d => d.charAt(0).toUpperCase() + d.slice(1))(fmtD(todayParis()))} · chaque validation demande ton code</p></div>
        <div class="tb-prog"><b>${faites}/${jour.length}</b><span>tâches du jour</span></div></header>
      <nav class="tb-tabs" role="tablist">
        <button role="tab" data-onglet="jour" aria-selected="${S.onglet === 'jour'}">Tâches du jour <i>${jour.length - faites}</i></button>
        <button role="tab" data-onglet="semaine" aria-selected="${S.onglet === 'semaine'}">Tâches de la semaine <i>${sem.filter(t => !t.fait_le).length}</i></button>
        <button role="tab" data-onglet="perte" class="perte" aria-selected="${S.onglet === 'perte'}">Déclarer une perte</button>
      </nav>
      <main class="tb-main">${corps}</main>
      <footer class="tb-f"><button class="btn ghost sm" id="premier">Première fois ? Créer mon code</button><button class="btn ghost sm" id="tbOut">Déconnecter la tablette</button></footer></div>`;
    S.app.querySelectorAll('[data-onglet]').forEach(b => b.onclick = () => { S.onglet = b.dataset.onglet; draw(); });
    S.app.querySelectorAll('[data-tache]').forEach(b => b.onclick = () => validerTache(+b.dataset.tache));
    S.app.querySelector('#premier').onclick = creerCode;
    S.app.querySelector('#tbOut').onclick = async () => { if (await confirmer('Déconnecter la tablette ? Il faudra le mot de passe du compte tablette pour la reconnecter.')) { clearInterval(S.timer); C().logout(); } };
    if (S.onglet === 'perte') bindPerte();
  }

  /* ---------- Code personnel ---------- */
  function pinPad(titre, sous) {
    return new Promise(resolve => {
      let pin = '';
      const ov = document.createElement('div'); ov.className = 'pin-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
      const render = err => {
        ov.innerHTML = `<div class="pin-card"><h3>${titre}</h3><p class="hint">${sous || 'Tape ton code à 4 chiffres'}</p>
          <div class="pin-dots" aria-label="${pin.length} chiffres saisis">${[0, 1, 2, 3].map(i => `<span class="${i < pin.length ? 'on' : ''}"></span>`).join('')}</div>
          <div class="pin-err" role="alert">${err || ''}</div>
          <div class="pin-keys">${['1', '2', '3', '4', '5', '6', '7', '8', '9', 'x', '0', '⌫'].map(k => k === 'x' ? '<button data-p="x" class="ann">Annuler</button>' : `<button data-p="${k}">${k}</button>`).join('')}</div></div>`;
        ov.querySelectorAll('[data-p]').forEach(b => b.onclick = () => {
          const k = b.dataset.p;
          if (k === 'x') { ov.remove(); resolve(null); return; }
          if (k === '⌫') pin = pin.slice(0, -1); else if (pin.length < 4) pin += k;
          if (pin.length === 4) { const p = pin; ov.remove(); resolve(p); return; }
          render();
        });
      };
      render(); document.body.appendChild(ov);
    });
  }
  function confirmer(txt) {
    return new Promise(resolve => {
      const ov = document.createElement('div'); ov.className = 'pin-ov';
      ov.innerHTML = `<div class="pin-card"><p>${txt}</p><div style="display:flex;gap:8px;justify-content:center"><button class="btn ghost" data-r="0">Annuler</button><button class="btn" data-r="1">Confirmer</button></div></div>`;
      ov.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { ov.remove(); resolve(b.dataset.r === '1'); });
      document.body.appendChild(ov);
    });
  }
  // Envoie une action signée ; redemande le code si le code est faux
  async function signer(titre, action) {
    let sous;
    for (let essai = 0; essai < 5; essai++) {
      const pin = await pinPad(titre, sous);
      if (!pin) return null;
      const { data, error } = await action(pin);
      if (error) { C().toast(error.message); return null; }
      if (typeof data === 'string' && data.startsWith('ERREUR:')) { sous = `<b style="color:var(--bad)">${data.slice(7)}</b>`; if (/10 minutes/.test(data)) { C().toast(data.slice(7)); return null; } continue; }
      return data;
    }
    return null;
  }

  async function validerTache(id) {
    const t = S.taches.find(x => x.id === id);
    const prenom = await signer(`Valider : ${C().esc(t.libelle)}`, pin => C().sb.rpc('bar_valider_tache', { p_pin: pin, p_tache: id }));
    if (!prenom) return;
    C().toast(`Tâche validée par ${prenom}`);
    await charger(); draw();
  }

  async function creerCode() {
    const { sb, esc, toast } = C();
    const { data, error } = await sb.rpc('bar_staff_liste');
    if (error) { toast(error.message); return; }
    const libres = (data || []).filter(s => !s.a_un_code);
    const ov = document.createElement('div'); ov.className = 'pin-ov';
    ov.innerHTML = `<div class="pin-card"><h3>Créer mon code</h3><p class="hint">Choisis ton prénom. Si ton prénom n'apparaît pas, tu as déjà un code : demande à Antoine ou Christophe de le réinitialiser.</p>
      <div class="noms">${libres.map(s => `<button class="btn ghost" data-s="${s.id}">${esc(s.prenom)}</button>`).join('') || '<p class="hint">Tout le monde a déjà un code.</p>'}</div>
      <button class="btn ghost sm" data-s="x">Fermer</button></div>`;
    document.body.appendChild(ov);
    ov.querySelectorAll('[data-s]').forEach(b => b.onclick = async () => {
      ov.remove(); if (b.dataset.s === 'x') return;
      const s = libres.find(x => x.id === +b.dataset.s);
      let sous;
      for (;;) {
        const p1 = await pinPad(`${esc(s.prenom)} : choisis ton code`, sous || 'Quatre chiffres, à garder pour toi. Pas de code trop simple.');
        if (!p1) return;
        const p2 = await pinPad(`${esc(s.prenom)} : confirme ton code`, 'Tape le même code une deuxième fois');
        if (!p2) return;
        if (p1 !== p2) { sous = '<b style="color:var(--bad)">Les deux codes ne sont pas identiques. Recommence.</b>'; continue; }
        const { error: e } = await sb.rpc('bar_definir_code', { p_staff: s.id, p_pin: p1 });
        if (e) { sous = `<b style="color:var(--bad)">${esc(e.message)}</b>`; continue; }
        toast(`Code créé pour ${s.prenom}`); return;
      }
    });
  }

  /* ---------- Pertes ---------- */
  function formPerte() {
    const { esc, fr } = C();
    const P = S.perte || (S.perte = { q: '', art: null, res: [], qte: 1, motif: null, com: '' });
    const u = P.art ? uniteBizzon(P.art.unite) : '';
    const rapides = u === 'bouteille' ? [0.1, 0.2, 0.5, 1] : u === 'L' ? [0.25, 0.5, 1, 20] : [];
    return `<div class="pf">
      <label class="pf-l" for="pfQ">Article</label>
      ${P.art ? `<div class="pf-art"><b>${esc(P.art.nom_bizzon)}</b><button class="btn ghost sm" id="pfChange">Changer</button></div>`
        : `<input id="pfQ" class="pf-in" autocomplete="off" placeholder="Tape au moins 2 lettres : heineken, coca, aperol…" value="${esc(P.q)}">
           <ul class="pf-res" id="pfRes">${P.res.map((r, i) => `<li><button data-r="${i}">${esc(r.nom_bizzon)} <span>${uniteBizzon(r.unite)}</span></button></li>`).join('')}</ul>`}
      ${P.art ? `
      <label class="pf-l">Quantité <span class="hint">en ${u}</span></label>
      <div class="pf-q"><button data-q="-">−</button><input id="pfQte" inputmode="decimal" value="${fr(P.qte, 3)}" aria-label="Quantité"><button data-q="+">+</button></div>
      ${rapides.length ? `<div class="pf-chips">${rapides.map(x => `<button data-v="${x}">${fr(x, 2)} ${u === 'L' ? 'L' : 'btl'}</button>`).join('')}</div>` : ''}
      <span class="hint">${u === 'bouteille' ? '1 verre de vin = 0,2 bouteille · 1 dose 4 cl = 0,06 bouteille de 70 cl' : u === 'L' ? '1 pression 25 cl = 0,25 L · 1 demi 50 cl = 0,5 L' : ''}</span>
      <label class="pf-l">Motif</label>
      <div class="pf-mot">${MOTIFS.map(m => `<button data-m="${m}" class="${P.motif === m ? 'on' : ''}">${m}</button>`).join('')}</div>
      <label class="pf-l" for="pfCom">Commentaire ${P.motif === 'Autre' ? '<span style="color:var(--bad)">obligatoire</span>' : '<span class="hint">facultatif</span>'}</label>
      <input id="pfCom" class="pf-in" maxlength="200" value="${esc(P.com)}" placeholder="Ex. : bouteille tombée pendant le service">
      <div class="pf-recap"><small>Récapitulatif</small><b>${esc(P.art.nom_bizzon)}</b><span>${P.motif || 'Motif à choisir'}</span><strong>${fr(P.qte, 3)} ${u}</strong>
        <p class="hint">La perte sera validée par Antoine ou Christophe, puis transférée dans Bizzon en fin de mois.</p>
        <button class="btn brass" id="pfGo" ${P.qte > 0 && P.motif && (P.motif !== 'Autre' || P.com.trim()) ? '' : 'disabled'}>Déclarer avec mon code</button></div>` : ''}
    </div>`;
  }
  let deb = null;
  function bindPerte() {
    const P = S.perte, $ = s => S.app.querySelector(s);
    const q = $('#pfQ');
    if (q) {
      q.focus(); q.setSelectionRange(q.value.length, q.value.length);
      q.oninput = () => { P.q = q.value; clearTimeout(deb); deb = setTimeout(async () => {
        if (P.q.trim().length < 2) { P.res = []; draw(); return; }
        const { data } = await C().sb.rpc('bar_articles_recherche', { p_q: P.q.trim() });
        P.res = data || []; draw(); }, 250); };
      S.app.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { P.art = P.res[+b.dataset.r]; P.qte = 1; draw(); });
      return;
    }
    $('#pfChange').onclick = () => { P.art = null; draw(); };
    const qte = $('#pfQte');
    qte.onchange = () => { const v = parseFloat(qte.value.replace(',', '.')); P.qte = isFinite(v) && v > 0 ? +v.toFixed(3) : P.qte; draw(); };
    S.app.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { P.qte = Math.max(0, +(P.qte + (b.dataset.q === '+' ? 1 : -1)).toFixed(3)); draw(); });
    S.app.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { P.qte = +b.dataset.v; draw(); });
    S.app.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { P.motif = b.dataset.m; draw(); });
    const com = $('#pfCom');
    com.oninput = () => { P.com = com.value; const g = $('#pfGo'); g.disabled = !(P.qte > 0 && P.motif && (P.motif !== 'Autre' || P.com.trim())); };
    $('#pfGo').onclick = async () => {
      const prenom = await signer('Déclarer la perte', pin => C().sb.rpc('bar_declarer_perte', { p_pin: pin, p_nom: P.art.nom_bizzon, p_quantite: P.qte, p_motif: P.motif, p_commentaire: P.com.trim() || null }));
      if (!prenom) return;
      C().toast(`Perte déclarée par ${prenom}. Merci !`);
      S.perte = null; draw();
    };
  }

  window.BarTablette = tablette;
})();
