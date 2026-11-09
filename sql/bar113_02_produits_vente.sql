-- Outil Bar 1.13 — script 02 : taux de TVA des produits vendus (pour afficher le CA TTC)
-- À coller une fois dans Supabase > SQL Editor > Run. Relançable sans dommage.
create table if not exists bar_produits_vente (
  nom           text primary key,          -- « Product name » de l'export Produits à vendre
  tva           numeric not null,          -- 0.2, 0.1 ou 0.055
  categorie     text,
  famille       text,
  sous_famille  text,
  maj_le        timestamptz not null default now()
);
alter table bar_produits_vente enable row level security;
drop policy if exists bar_admin_all on bar_produits_vente;
create policy bar_admin_all on bar_produits_vente for all to authenticated using (bar_is_admin()) with check (bar_is_admin());
select 'ok' as resultat;
