/* Outil Bar 1.13 — fiches techniques et ratio matière.
   Les prix de vente viennent de l'export Bizzon « Produits à vendre », les prix d'achat du dernier Stock théorique importé.
   Les fiches simples (alcool à la dose, vin au verre, bière, soft, produit à la pièce) sont pré-remplies automatiquement. */
(function (root) {
  'use strict';
  const DOSE_ALCOOL = 6, VERRE_VIN = 15;      // cl, décidés par Antoine le 11/11/2026
  const AUTO = /^(Alcool|Aperitif|Digestif|Vin|Champagne|Biere|Soft)$/;

  /* ---------- Rapprochement produit vendu ↔ article de stock ---------- */
  const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/(\d)(ANS?)\b/g, '$1 $2').replace(/\s+/g, ' ').trim();
  const STOP = new Set(['CL', 'L', 'VC', 'VP', 'BTL', 'BOUTEILLE', 'VERRE', 'DE', 'LA', 'LE', 'DU', 'DES', 'AOP', 'AOC', 'IGP', 'THE', 'ET', 'X', 'B', 'W', 'R', 'CHT', 'CHATEAU', 'PRESSION', 'FUT', 'DAVID', 'SLIM', 'BOITE', 'CANETTE', 'SUP', 'SUPP', 'SUPPLEMENT', 'SUPLLEMENT']);
  const taille = t => /^\d+([.,]\d+)?(CL|L)$/.test(t) || ['20', '25', '33', '37', '50', '70', '75', '100'].includes(t);
  const toks = s => norm(s).split(' ').filter(t => t && !STOP.has(t) && !taille(t) && (t.length > 1 || /\d/.test(t)));
  const nums = ts => ts.filter(t => /^\d+$/.test(t));
  const FAM = { Alcool: /APERITIF|ALCOOL|DIGESTIF/, Aperitif: /APERITIF|ALCOOL|VIN/, Digestif: /APERITIF|ALCOOL|DIGESTIF/, Vin: /VIN|37\.5/, Champagne: /CHAMPAGNE|VIN|APERITIF/, Biere: /BIERE/, Soft: /SOFT|EAU/ };

  function rapprocher(texte, cat, stock, filtre) {
    const pt = toks(texte), pn = nums(pt);
    let best = null;
    for (const s of stock) {
      if (filtre && !filtre(s)) continue;
      if (FAM[cat] && !FAM[cat].test(s.famille || '') && !(filtre && filtre.libre)) continue;
      const st = toks(s.nom_bizzon), sn = nums(st);
      const mots = pt.filter(t => !/^\d+$/.test(t)).length ? pt.filter(t => !/^\d+$/.test(t)) : pt; // « 1664 » : on garde le nombre
      const inter = mots.filter(t => st.some(u => u === t || (t.length > 3 && u.length > 3 && (u.startsWith(t) || t.startsWith(u))))).length;
      if (!inter) continue;
      let sc = inter / Math.max(mots.length, 1) - 0.06 * Math.max(0, st.length - inter - sn.length);
      if (pn.length && sn.length && !pn.some(n => sn.includes(n))) sc -= 0.6;          // 7 ans ≠ 3 ans
      else if (pn.length && !sn.length) sc -= 0.2;
      else if (!pn.length && sn.length) sc -= 0.25;                                    // Heineken ≠ Heineken 00
      if (pn.length && sn.length && pn.every(n => sn.includes(n))) sc += 0.1;
      if (!/^1\.000 /.test(s.unite || '')) sc -= 0.15;                                  // carton, pack
      if (!best || sc > best.sc) best = { sc, s };
    }
    return best;
  }

  // Volume d'une bouteille de stock, en cl, lu dans son nom (70CL, 1L, 37,5CL, 20L…)
  function volumeCl(nom) {
    const n = norm(nom).replace(/(\d+) (\d)(?= ?CL\b)/g, '$1.$2'); // 37,5CL → 37.5CL, sans coller « 2020 75CL » ni « 15° 1L »
    let m = /(\d+(?:\.\d+)?) ?CL\b/.exec(n); if (m) return Number(m[1]);
    m = /(\d+(?:\.\d+)?) ?L\b/.exec(n); if (m) return Number(m[1]) * 100;
    return null;
  }
  const clDe = v => { const m = /(\d+(?:[.,]\d+)?)\s*-?\s*cl/i.exec(v || ''); return m ? Number(m[1].replace(',', '.')) : null; };

  /**
   * Proposition automatique pour un produit vendu (une variante).
   * Renvoie { statut, lignes: [{nom_bizzon, quantite, note}], remarque }
   */
  function proposer(f, stock) {
    const cat = f.categorie || '', v = f.variante || '', nom = f.produit || '';
    if (!AUTO.test(cat)) return { statut: 'a_saisir', lignes: [], remarque: 'Recette à saisir (cocktail ou produit composé)' };
    if (/forfait|libre|droit de bouchon|bouteille alcool/i.test(nom)) return { statut: 'a_saisir', lignes: [], remarque: 'Produit ouvert ou forfait : pas de recette fixe' };
    if (/sirop/i.test(nom)) return { statut: 'a_saisir', lignes: [], remarque: 'Dose de sirop à préciser' };
    if (/press[ée]/i.test(nom)) return { statut: 'a_saisir', lignes: [], remarque: 'Jus pressé : recette à saisir' };
    const pression = /pression/i.test(nom);
    const slim = /slim|boite|canette/i.test(nom + ' ' + v);
    const filtre = pression ? s => /FUT/.test(norm(s.nom_bizzon)) : slim ? Object.assign(s => /SLIM|BOITE/.test(norm(s.nom_bizzon)) && /BIERE|SOFT|BOISSON|HOTEL|MINIBAR/.test(s.famille || ''), { libre: true }) : s => !/FUT\b|SIROP|MONIN|SLIM|BOITE/.test(norm(s.nom_bizzon));
    const nomSansSup = nom.replace(/^(sup+\.?|suppl[ée]ment)\s+/i, '');
    const texte = cat === 'Soft' && v && !/cl$/i.test(v) ? `${nomSansSup} ${v === 'classic' ? '' : v}` : nomSansSup;
    let b = rapprocher(texte, cat, stock, filtre);
    if ((!b || b.sc < 0.45) && !pression && !slim) b = rapprocher(texte, cat, stock, s => !/FUT\b|SIROP|MONIN/.test(norm(s.nom_bizzon))); // Red Bull : seulement en boîte
    if (!b || b.sc < 0.45) return { statut: 'a_saisir', lignes: [], remarque: 'Article de stock introuvable automatiquement' };
    const s = b.s, sur = b.sc >= 0.95;
    const vol = volumeCl(s.nom_bizzon), parLitre = /liter/.test(s.unite || '');
    const ligne = (q, note) => ({ nom_bizzon: s.nom_bizzon, quantite: q === null ? null : +q.toFixed(4), note });
    const res = (q, note, certain, rem) => ({ statut: q === null ? 'a_saisir' : certain && sur ? 'auto' : 'a_verifier', lignes: [ligne(q, note)], remarque: rem || (sur ? null : 'Rapprochement à confirmer') });

    if (pression) {
      const cl = clDe(v) || clDe(nom);
      if (!cl) return res(null, null, false, 'Taille du verre inconnue');
      const melange = /panach|monaco/i.test(v);
      return res(cl / 100, `${cl} cl de bière`, !melange, melange ? 'Panaché / Monaco : part de bière à préciser (compté ici comme un verre plein)' : null);
    }
    if (parLitre) return res(null, null, false, 'Article de stock suivi au litre : quantité à préciser');
    const bouteille = /bouteille|^\d+(?:[.,]\d+)?\s*cl$/i.test(v) || /\b75\s*cl\b/i.test(nom) && !/verre/i.test(nom + v);
    if (cat === 'Vin' || cat === 'Champagne') {
      if (/verre/i.test(nom + ' ' + v)) {
        const dose = clDe(v) || VERRE_VIN, v75 = vol || 75;
        return res(dose / v75, `verre ${String(dose).replace('.', ',')} cl`, cat === 'Vin' && !!vol, !vol ? 'Contenance absente du nom Bizzon : bouteille de 75 cl supposée' : cat === 'Champagne' ? 'Verre de bulles : 15 cl à confirmer' : null);
      }
      if (/coupe/i.test(nom + ' ' + v)) return res(null, null, false, 'Dose d’une coupe à préciser');
      if (bouteille || !v) {
        const cl = clDe(v);
        if (cl && vol && Math.abs(cl - vol) > 1) return res(null, null, false, `Variante ${cl} cl mais article de stock en ${vol} cl : choisir le bon article`);
        return res(1, '1 bouteille', true);
      }
      return res(null, null, false, `Variante « ${v} » à préciser`);
    }
    if (cat === 'Biere' || cat === 'Soft') {
      const cl = clDe(v) || clDe(nom);
      if (cl && vol && Math.abs(cl - vol) > 1) return res(1, '1 bouteille', false, `Produit en ${cl} cl mais article de stock en ${vol} cl : choisir le bon article`);
      return res(1, '1 bouteille ou canette', /^1\.000 /.test(s.unite || ''), /^1\.000 /.test(s.unite || '') ? null : 'Article de stock suivi par carton : vérifier l’unité');
    }
    // Alcool, apéritif, digestif : dose de 6 cl, ou dose écrite dans le nom (Pastis 3cl)
    if (bouteille) return res(1, '1 bouteille', true);
    if (!vol) return res(null, null, false, 'Contenance de la bouteille introuvable dans le nom Bizzon');
    const dose = clDe(nom) || DOSE_ALCOOL;
    return res(dose / vol, `${String(dose).replace('.', ',')} cl`, cat !== 'Aperitif', cat === 'Aperitif' ? 'Apéritif : dose de 6 cl à confirmer (pastis, kir, vermouth…)' : null);
  }

  // Coût matière HT d'une fiche, avec les prix d'achat du stock
  function cout(lignes, prix) {
    let c = 0, manque = [];
    for (const l of lignes) {
      const p = l.prix_unitaire !== null && l.prix_unitaire !== undefined ? { prix: l.prix_unitaire } : prix[l.nom_bizzon];
      if (l.quantite === null || l.quantite === undefined) { manque.push('quantité'); continue; }
      if (!p) { manque.push(l.nom_bizzon); continue; }
      c += Number(l.quantite) * Number(p.prix);
    }
    return { cout: +c.toFixed(3), complet: !manque.length && lignes.length > 0, manque };
  }

  const api = { proposer, cout, volumeCl, rapprocher, DOSE_ALCOOL, VERRE_VIN };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  root.BarFiches = api;

  /* ================= Écran « Fiches & ratios » (ordinateur) ================= */
  const C = () => root.BarCtx;
  const ST = { auto: ['Automatique', 'p-ok'], validee: ['Validée', 'p-ok'], a_verifier: ['À vérifier', 'p-warn'], a_saisir: ['À saisir', 'p-mute'] };
  let F = { cat: '', statut: '', q: '', ouvert: null, tri: 'ratio' };

  async function dernierStock() {
    const { sb } = C();
    const { data: imp } = await sb.from('bar_imports').select('id,exporte_le').eq('type', 'stock').order('exporte_le', { ascending: false }).limit(1);
    if (!imp || !imp[0]) return { imp: null, lignes: [] };
    const { data } = await sb.from('bar_stock_theo').select('nom_bizzon,famille,unite,prix').eq('import_id', imp[0].id).limit(5000);
    return { imp: imp[0], lignes: data || [] };
  }

  // Appelé après l'import d'un export « Produits à vendre »
  async function importerProduits(res) {
    const { sb, user } = C();
    const stock = (await dernierStock()).lignes;
    const { data: exist } = await sb.from('bar_fiches').select('id,produit_id,variante');
    const cle = f => f.produit_id + '|' + f.variante;
    const deja = new Map((exist || []).map(f => [cle(f), f.id]));
    const vus = new Set(res.lignes.map(cle));
    let nouveaux = 0, majs = 0;
    const maj = res.lignes.filter(l => deja.has(cle(l))).map(l => ({ id: deja.get(cle(l)), ...l, maj_le: new Date().toISOString() }));
    for (let i = 0; i < maj.length; i += 300) { const { error } = await sb.from('bar_fiches').upsert(maj.slice(i, i + 300), { onConflict: 'id' }); if (error) throw new Error(error.message); }
    majs = maj.length;
    // Produits retirés de Bizzon : désactivés, pas supprimés
    const retires = (exist || []).filter(f => !vus.has(cle(f))).map(f => f.id);
    if (retires.length) await sb.from('bar_fiches').update({ actif: false }).in('id', retires);
    const neufs = res.lignes.filter(l => !deja.has(cle(l)));
    for (let i = 0; i < neufs.length; i += 200) {
      const lot = neufs.slice(i, i + 200).map(l => { const p = proposer(l, stock); return { row: { ...l, statut: p.statut, remarque: p.remarque }, lignes: p.lignes }; });
      const { data: ins, error } = await sb.from('bar_fiches').insert(lot.map(x => x.row)).select('id,produit_id,variante');
      if (error) throw new Error(error.message);
      const idDe = new Map(ins.map(f => [cle(f), f.id]));
      const lignes = lot.flatMap(x => x.lignes.map(l => ({ ...l, fiche_id: idDe.get(cle(x.row)) })));
      if (lignes.length) { const { error: e2 } = await sb.from('bar_fiche_lignes').insert(lignes); if (e2) throw new Error(e2.message); }
      nouveaux += lot.length;
    }
    await sb.from('bar_imports').insert({ type: 'produits', fichier: res.fichier || null, nb_lignes: res.lignes.length, importe_par: user().id });
    const sansStock = stock.length ? '' : ' Aucun stock théorique importé : les fiches automatiques seront à relancer après un import de stock.';
    return `Produits à vendre : ${nouveaux} nouvelle${nouveaux > 1 ? 's' : ''} fiche${nouveaux > 1 ? 's' : ''}, ${majs} prix mis à jour, ${retires.length} produit${retires.length > 1 ? 's' : ''} retiré${retires.length > 1 ? 's' : ''} de la vente.${sansStock}`;
  }

  async function vue(M) {
    const { sb, esc, fr, eur, fmtDT, toast } = C();
    M.innerHTML = '<div class="hint">Chargement des fiches…</div>';
    const [{ data: fiches, error }, { data: lignes }, st, { data: reg }] = await Promise.all([
      sb.from('bar_fiches').select('*').eq('actif', true).order('categorie').order('produit').limit(2000),
      sb.from('bar_fiche_lignes').select('*').limit(10000),
      dernierStock(),
      sb.from('bar_reglages').select('valeur').eq('cle', 'ratio_cible').maybeSingle()]);
    if (error) { M.innerHTML = `<div class="main-h"><div><h2>Fiches et ratios</h2></div></div><div class="empty">${/bar_fiches/.test(error.message) ? 'Lance le script SQL 05 dans Supabase, puis importe l’export « Produits à vendre ».' : esc(error.message)}</div>`; return; }
    const cible = Number(reg && reg.valeur) || 25;
    const prix = Object.fromEntries(st.lignes.map(l => [l.nom_bizzon, l]));
    const parFiche = {}; (lignes || []).forEach(l => (parFiche[l.fiche_id] = parFiche[l.fiche_id] || []).push(l));
    const rows = (fiches || []).map(f => {
      const ls = parFiche[f.id] || [], c = cout(ls, prix);
      const ht = f.prix_ttc !== null && f.tva !== null ? f.prix_ttc / (1 + f.tva / 100) : null;
      const ratio = c.complet && ht ? c.cout / ht * 100 : null;
      return { f, ls, ...c, ht, ratio, marge: c.complet && ht !== null ? ht - c.cout : null };
    });
    if (!rows.length) { M.innerHTML = `<div class="main-h"><div><h2>Fiches et ratios</h2><p>Importe l'export Bizzon « Produits à vendre » (fichier ModeleProduitsAVendre.xlsx) sur la page Aujourd'hui : les fiches simples se créent toutes seules.</p></div></div><div class="empty">Aucune fiche pour l'instant.</div>`; return; }
    const cats = [...new Set(rows.map(r => r.f.categorie || 'Sans catégorie'))].sort();
    const vis = rows.filter(r => (!F.cat || (r.f.categorie || 'Sans catégorie') === F.cat) && (!F.statut || r.f.statut === F.statut) && (!F.q || (r.f.produit + ' ' + r.f.variante + ' ' + r.ls.map(l => l.nom_bizzon).join(' ')).toLowerCase().includes(F.q.toLowerCase())))
      .sort((a, b) => F.tri === 'ratio' ? (b.ratio ?? -1) - (a.ratio ?? -1) : F.tri === 'marge' ? (a.marge ?? 1e9) - (b.marge ?? 1e9) : a.f.produit.localeCompare(b.f.produit));
    F.liste = vis.slice(0, 400).map(r => r.f.id); F.cible = cible;
    F.libres = [...new Map((lignes || []).filter(l => l.unite_libre).map(l => [l.nom_bizzon, l])).values()];
    const nb = s => rows.filter(r => r.f.statut === s).length;
    const avecRatio = rows.filter(r => r.ratio !== null), auDessus = avecRatio.filter(r => r.ratio > cible);
    const compo = r => r.ls.length ? r.ls.map(l => `${l.note ? esc(l.note) : fr(l.quantite, 3)} · ${esc(l.nom_bizzon)}`).join('<br>') : `<span class="hint">${esc(r.f.remarque || 'Aucune composition')}</span>`;
    const ratioCell = r => r.ratio === null ? `<span class="hint">${r.manque.length && r.ls.length ? (r.manque.includes('quantité') ? 'quantité manquante' : 'prix absent') : '–'}</span>` : `<b class="${r.ratio > cible ? 'neg' : ''}">${fr(r.ratio, 1)} %</b>`;
    M.innerHTML = `<div class="main-h"><div><h2>Fiches et ratios</h2><p>Ratio matière = coût matière HT ÷ prix de vente HT. Prix d'achat du stock théorique ${st.imp ? 'exporté le ' + fmtDT(st.imp.exporte_le) : '<b>non importé</b>'}. Doses : alcool ${DOSE_ALCOOL} cl, vin ${VERRE_VIN} cl.</p></div></div>
      <div class="tiles">
        <div class="tile"><div class="k">Fiches avec ratio</div><div class="v">${avecRatio.length}<small style="font-size:14px;color:var(--muted)">/${rows.length}</small></div><div class="s">${nb('auto')} automatiques · ${nb('validee')} validées</div></div>
        <div class="tile ${nb('a_verifier') ? 'warm' : ''}"><div class="k">À vérifier</div><div class="v">${nb('a_verifier')}</div><div class="s">rapprochement ou dose à confirmer</div></div>
        <div class="tile"><div class="k">À saisir</div><div class="v">${nb('a_saisir')}</div><div class="s">cocktails, plats, produits composés</div></div>
        <div class="tile"><div class="k">Au-dessus de la cible</div><div class="v ${auDessus.length ? 'neg' : ''}">${auDessus.length}</div><div class="s">cible <input id="cible" type="number" min="5" max="80" step="1" value="${cible}" aria-label="Ratio cible en %" style="width:52px;font:inherit;font-weight:700;padding:2px 4px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--ink)"> %</div></div>
      </div>
      <div class="filtres"><input id="fq" class="sel" placeholder="Rechercher un produit ou un article…" value="${esc(F.q)}" style="font-weight:500;min-width:260px">
        <select id="fcat" class="sel"><option value="">Toutes catégories</option>${cats.map(c => `<option ${c === F.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <select id="fst" class="sel"><option value="">Tous statuts</option>${Object.entries(ST).map(([k, [l]]) => `<option value="${k}" ${k === F.statut ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <select id="ftri" class="sel">${[['ratio', 'Trier : ratio le plus haut'], ['marge', 'Trier : marge la plus faible'], ['nom', 'Trier : nom']].map(([k, l]) => `<option value="${k}" ${k === F.tri ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <span class="hint">${vis.length} fiche${vis.length > 1 ? 's' : ''}</span></div>
      <div class="tbl"><table class="t fiches"><thead><tr><th>Produit</th><th>Catégorie</th><th class="n">Prix TTC</th><th class="n">Prix HT</th><th>Composition</th><th class="n">Coût HT</th><th class="n">Ratio</th><th class="n">Marge HT</th><th>Statut</th></tr></thead><tbody>
        ${vis.slice(0, 400).map(r => `<tr data-f="${r.f.id}" class="${F.ouvert === r.f.id ? 'open' : ''}"><td><b>${esc(r.f.produit)}</b>${r.f.variante ? `<div class="hint">${esc(r.f.variante)}</div>` : ''}</td><td class="hint">${esc(r.f.categorie || '')}</td>
          <td class="n">${r.f.prix_ttc === null ? '–' : eur(r.f.prix_ttc)}</td><td class="n">${r.ht === null ? '–' : eur(r.ht)}</td><td class="compo">${compo(r)}</td>
          <td class="n">${r.complet ? eur(r.cout) : '–'}</td><td class="n">${ratioCell(r)}</td><td class="n">${r.marge === null ? '–' : eur(r.marge)}</td>
          <td><span class="pill ${ST[r.f.statut][1]}">${ST[r.f.statut][0]}</span></td></tr>${F.ouvert === r.f.id ? `<tr class="edit"><td colspan="9">${editeur(r, st.lignes)}</td></tr>` : ''}`).join('')}
      </tbody></table></div>
      ${vis.length > 400 ? '<span class="hint">400 premières fiches affichées : affine avec les filtres.</span>' : ''}
      <span class="hint">Clique sur une ligne pour corriger la composition. Une fiche corrigée passe en « Validée » et n'est plus jamais modifiée par un import. Les prix de vente se mettent à jour à chaque import de l'export « Produits à vendre », les prix d'achat à chaque import du stock.</span>`;
    const re = () => vue(M);
    let deb;
    M.querySelector('#fq').oninput = e => { clearTimeout(deb); deb = setTimeout(() => { F.q = e.target.value; re().then(() => { const i = M.querySelector('#fq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 300); };
    M.querySelector('#fcat').onchange = e => { F.cat = e.target.value; re(); };
    M.querySelector('#fst').onchange = e => { F.statut = e.target.value; re(); };
    M.querySelector('#ftri').onchange = e => { F.tri = e.target.value; re(); };
    M.querySelector('#cible').onchange = async e => { const v = Number(e.target.value); if (!(v > 0)) return; await sb.from('bar_reglages').upsert({ cle: 'ratio_cible', valeur: v }, { onConflict: 'cle' }); re(); };
    M.querySelectorAll('tr[data-f]').forEach(tr => tr.onclick = () => { F.ouvert = F.ouvert === +tr.dataset.f ? null : +tr.dataset.f; re().then(() => { const f = document.getElementById('feQ'); if (f) f.focus(); }); });
    const ed = M.querySelector('tr.edit'); if (ed) bindEditeur(ed, rows.find(r => r.f.id === F.ouvert), st.lignes, prix, re);
  }

  /* ---------- Éditeur de fiche : recherche au fil de la frappe, dose dans l'unité naturelle (cl, g, pièce) ---------- */
  const sansAccent = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  // Base de conversion d'un article de stock : combien d'unités « naturelles » dans une unité de stock
  function base(nom, unite) {
    if (/kilogram/.test(unite || '')) return { mode: 'g', par: 1000 };
    if (/liter/.test(unite || '')) return { mode: 'cl', par: 100 };
    const vol = volumeCl(nom);
    return vol ? { mode: 'cl', par: vol } : { mode: 'pièce', par: 1 };
  }
  const PAR_LIBRE = { g: 1000, cl: 100, 'pièce': 1 };
  function enDose(l, stock) {
    if (l.unite_libre) { const par = PAR_LIBRE[l.unite_libre]; return { s: { prix: l.prix_unitaire ?? undefined, unite: 'hors stock' }, mode: l.unite_libre, par, libre: true, dose: l.quantite === null || l.quantite === undefined ? null : +(l.quantite * par).toFixed(3) }; }
    const s = stock.find(x => x.nom_bizzon === l.nom_bizzon) || {};
    const b = base(l.nom_bizzon, s.unite);
    const mode = l.mode || (l.note && /^1 /.test(l.note) ? 'pièce' : b.mode);
    const par = mode === 'pièce' ? 1 : mode === 'g' ? (b.mode === 'g' ? 1000 : null) : (b.mode === 'cl' ? b.par : (l.contenance || null));
    return { s, mode, par, dose: l.quantite === null || l.quantite === undefined || !par ? null : +(l.quantite * par).toFixed(3) };
  }

  function editeur(r, stock) {
    const { esc, fr, eur } = C();
    const L = (r._edit = r._edit || r.ls.map(l => ({ ...l })));
    let total = 0, complet = L.length > 0;
    const lignes = L.map((l, i) => {
      const d = enDose(l, stock), c = l.quantite !== null && l.quantite !== undefined && d.s.prix !== undefined ? l.quantite * Number(d.s.prix) : null;
      if (c === null) complet = false; else total += c;
      const lib = d.libre ? `<div class="hint">hors stock Bizzon · prix d'achat HT <input data-pu="${i}" inputmode="decimal" value="${l.prix_unitaire ?? ''}" placeholder="prix" style="width:70px"> € ${l.unite_libre === 'g' ? 'le kg' : l.unite_libre === 'cl' ? 'le litre' : 'la pièce'}</div>` : '';
      return `<tr><td><b>${esc(l.nom_bizzon)}</b>${lib || `<div class="hint">${esc(d.s.unite || 'article absent du dernier stock')}${d.s.prix !== undefined ? ' · ' + eur(Number(d.s.prix)) : ''}</div>`}</td>
        <td class="n"><input data-dose="${i}" inputmode="decimal" value="${d.dose === null ? '' : fr(d.dose, 3)}" aria-label="Dose" placeholder="dose"></td>
        <td><select data-mode="${i}" aria-label="Unité">${['cl', 'pièce', 'g'].map(m => `<option ${m === d.mode ? 'selected' : ''}>${m}</option>`).join('')}</select>
          ${d.mode === 'cl' && !d.par ? `<input data-cont="${i}" inputmode="decimal" placeholder="contenance cl" style="width:110px" aria-label="Contenance de la bouteille en cl">` : ''}</td>
        <td class="n">${c === null ? '–' : eur(c)}</td><td><button class="btn ghost sm" data-del="${i}" aria-label="Retirer">✕</button></td></tr>`;
    }).join('');
    const ht = r.ht, ratio = complet && ht ? total / ht * 100 : null;
    const idx = (F.liste || []).indexOf(r.f.id), suivant = idx >= 0 && idx < F.liste.length - 1;
    return `<div class="fe"><div class="fe-h"><b>${esc(r.f.produit)}${r.f.variante ? ' · ' + esc(r.f.variante) : ''}</b><span class="hint">${r.f.prix_ttc !== null ? eur(r.f.prix_ttc) + ' TTC · ' + eur(ht) + ' HT' : 'prix de vente absent'}</span>${r.f.remarque ? `<span class="pill p-warn">${esc(r.f.remarque)}</span>` : ''}</div>
      <div class="fe-add"><input id="feQ" class="sel" placeholder="Ajouter un ingrédient : tape quelques lettres (ex. hav, sirop canne, citron)… puis Entrée" autocomplete="off" value="${esc(r._q || '')}"><div id="feRes" class="fe-res"></div></div>
      ${L.length ? `<table class="t"><thead><tr><th>Ingrédient (article de stock)</th><th class="n">Dose</th><th>Unité</th><th class="n">Coût HT</th><th></th></tr></thead><tbody>${lignes}</tbody>
        <tfoot><tr><td><b>Total</b></td><td></td><td></td><td class="n"><b>${complet ? eur(total) : '–'}</b></td><td></td></tr></tfoot></table>` : '<span class="hint">Aucun ingrédient pour l’instant.</span>'}
      <div class="fe-tot"><span>Coût matière <b>${complet ? eur(total) : '–'}</b></span><span>Ratio <b class="${ratio !== null && ratio > F.cible ? 'neg' : ''}">${ratio === null ? '–' : fr(ratio, 1) + ' %'}</b></span><span>Marge HT <b>${complet && ht ? eur(ht - total) : '–'}</b></span></div>
      <div class="fe-act">${suivant ? '<button class="btn brass" id="feNext">Valider et passer à la suivante ›</button>' : ''}<button class="btn ${suivant ? '' : 'brass'}" id="feOk">Valider la fiche</button><button class="btn ghost" id="feNo">Annuler</button></div></div>`;
  }

  function bindEditeur(el, r, stock, prix, re) {
    const { sb, toast, esc } = C();
    const L = r._edit;
    const num = v => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : null; };
    el.onclick = e => e.stopPropagation();
    const majQ = (i) => { const l = L[i], d = enDose(l, stock), v = num(el.querySelector(`[data-dose="${i}"]`).value);
      l.quantite = v === null || !d.par ? null : +(v / d.par).toFixed(5); l.note = v === null ? null : `${String(v).replace('.', ',')} ${d.mode}`; };
    el.querySelectorAll('[data-dose]').forEach(inp => {
      inp.onchange = () => { if (inp.dataset.fait) return; inp.dataset.fait = 1; majQ(+inp.dataset.dose); r._focus = null; redraw(); };
      inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); if (inp.dataset.fait) return; inp.dataset.fait = 1; majQ(+inp.dataset.dose); r._focus = 'q'; redraw(); } };
    });
    el.querySelectorAll('[data-pu]').forEach(inp => inp.onchange = () => { L[+inp.dataset.pu].prix_unitaire = num(inp.value); redraw(); });
    el.querySelectorAll('[data-mode]').forEach(sl => sl.onchange = () => { const i = +sl.dataset.mode, l = L[i], d = enDose(l, stock); const v = d.dose; if (l.unite_libre) { l.unite_libre = sl.value; } else l.mode = sl.value; const d2 = enDose(l, stock); l.quantite = v === null || !d2.par ? null : +(v / d2.par).toFixed(5); l.note = v === null ? null : `${String(v).replace('.', ',')} ${l.unite_libre || l.mode}`; redraw(); });
    el.querySelectorAll('[data-cont]').forEach(inp => inp.onchange = () => { const l = L[+inp.dataset.cont]; l.contenance = num(inp.value); redraw(); });
    el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { L.splice(+b.dataset.del, 1); redraw(); });
    const q = el.querySelector('#feQ'), res = el.querySelector('#feRes');
    let hits = [];
    const chercher = () => {
      r._q = q.value;
      const mots = sansAccent(q.value).split(/\s+/).filter(Boolean);
      if (!mots.length || mots.join('').length < 2) { res.innerHTML = ''; hits = []; return; }
      const libres = (F.libres || []).filter(x => mots.every(m => sansAccent(x.nom_bizzon).includes(m))).slice(0, 4);
      hits = libres.map(x => ({ ...x, libre: true })).concat(stock.filter(s => { const n = sansAccent(s.nom_bizzon); return mots.every(m => n.includes(m)); }).slice(0, 10));
      res.innerHTML = hits.map((s, i) => `<button data-h="${i}" class="${i === 0 ? 'first' : ''}">${esc(s.nom_bizzon)} <span class="hint">${s.libre ? `hors stock · ${C().eur(Number(s.prix_unitaire))} ${s.unite_libre === 'g' ? '/kg' : s.unite_libre === 'cl' ? '/L' : '/pièce'}` : esc((s.unite || '').replace('1.000 ', ''))}</span></button>`).join('')
        + `<button data-libre="1" class="libre">＋ « ${esc(q.value.trim())} » hors stock Bizzon (prix à saisir)</button>`;
      res.querySelectorAll('[data-h]').forEach(b => b.onclick = () => ajouter(hits[+b.dataset.h]));
      res.querySelector('[data-libre]').onclick = () => { L.push({ nom_bizzon: q.value.trim().toLowerCase(), quantite: null, note: null, unite_libre: 'g', prix_unitaire: null }); r._q = ''; r._focus = L.length - 1; redraw(); };
    };
    const ajouter = s => { L.push(s.libre ? { nom_bizzon: s.nom_bizzon, quantite: null, note: null, unite_libre: s.unite_libre, prix_unitaire: s.prix_unitaire } : { nom_bizzon: s.nom_bizzon, quantite: null, note: null }); r._q = ''; r._focus = L.length - 1; redraw(); };
    q.oninput = chercher;
    q.onkeydown = e => { if (e.key === 'Enter' && hits[0]) { e.preventDefault(); ajouter(hits[0]); } };
    if (q.value) chercher();
    const enregistrer = async () => {
      if (!L.length) { toast('Ajoute au moins un ingrédient'); return false; }
      if (L.some(l => l.quantite === null || l.quantite === undefined || !(l.quantite >= 0))) { toast('Une dose manque'); return false; }
      if (L.some(l => l.unite_libre && !(l.prix_unitaire > 0))) { toast('Saisis le prix d’achat de l’ingrédient hors stock'); return false; }
      const { error: e1 } = await sb.from('bar_fiche_lignes').delete().eq('fiche_id', r.f.id);
      const { error: e2 } = e1 ? { error: e1 } : await sb.from('bar_fiche_lignes').insert(L.map(l => ({ fiche_id: r.f.id, nom_bizzon: l.nom_bizzon, quantite: l.quantite, note: l.note || null, ...(l.unite_libre ? { unite_libre: l.unite_libre, prix_unitaire: l.prix_unitaire } : {}) })));
      const { error: e3 } = e2 ? { error: e2 } : await sb.from('bar_fiches').update({ statut: 'validee', remarque: null, maj_le: new Date().toISOString() }).eq('id', r.f.id);
      if (e3) { toast(/prix_unitaire|unite_libre/.test(e3.message) ? 'Lance le script SQL 06 dans Supabase pour les ingrédients hors stock.' : 'Non enregistré : ' + e3.message); return false; }
      return true;
    };
    el.querySelector('#feNo').onclick = () => { delete r._edit; F.ouvert = null; re(); };
    el.querySelector('#feOk').onclick = async () => { if (await enregistrer()) { toast('Fiche validée'); F.ouvert = null; re(); } };
    const nx = el.querySelector('#feNext');
    if (nx) nx.onclick = async () => { const idx = F.liste.indexOf(r.f.id), next = F.liste[idx + 1]; if (await enregistrer()) { toast('Fiche validée'); F.ouvert = next; re().then(() => { const o = document.querySelector('tr.open'); if (o) o.scrollIntoView({ block: 'start', behavior: 'smooth' }); const f = document.getElementById('feQ'); if (f) f.focus(); }); } };
    // Focus : après l'ajout d'un ingrédient on saisit sa dose ; après la dose on revient à la recherche
    if (typeof r._focus === 'number') { const d = el.querySelector(`[data-dose="${r._focus}"]`); if (d) { d.focus(); d.select(); } }
    else if (r._focus === 'q') q.focus();
    r._focus = null;
    function redraw() { if (r._dessin) return; r._dessin = true; try { el.querySelector('td').innerHTML = editeur(r, stock); } finally { r._dessin = false; } bindEditeur(el, r, stock, prix, re); }
  }

  root.BarFiches.vue = vue;
  root.BarFiches.importerProduits = importerProduits;
})(typeof window !== 'undefined' ? window : globalThis);
