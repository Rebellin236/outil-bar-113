-- =====================================================================
-- Outil Bar 1.13 — script 05 : fiches techniques et ratio matière
-- À coller une fois dans Supabase > SQL Editor > Run. Relançable sans dommage.
-- Ne touche à aucune table de TableFlow.
-- =====================================================================

-- Un produit vendu dans Bizzon (une ligne par variante : Verre, Bouteille, 25cl…)
create table if not exists bar_fiches (
  id           bigserial primary key,
  produit_id   text not null,                 -- identifiant Bizzon du produit à vendre
  produit      text not null,
  variante     text not null default '',
  categorie    text,
  prix_ttc     numeric(10,2),
  tva          numeric(4,2),                  -- 20, 10 ou 5,5
  actif        boolean not null default true,
  statut       text not null default 'a_saisir' check (statut in ('auto','a_verifier','a_saisir','validee')),
  remarque     text,
  maj_le       timestamptz not null default now(),
  unique (produit_id, variante)
);

-- Composition : quantité exprimée dans l'unité de stock Bizzon (0,086 bouteille = 6 cl d'une 70 cl ; 0,25 L de fût…)
create table if not exists bar_fiche_lignes (
  id          bigserial primary key,
  fiche_id    bigint not null references bar_fiches(id) on delete cascade,
  nom_bizzon  text not null,
  quantite    numeric(12,4),
  note        text
);
create index if not exists bar_fiche_lignes_fiche on bar_fiche_lignes(fiche_id);

alter table bar_imports drop constraint if exists bar_imports_type_check;
alter table bar_imports add constraint bar_imports_type_check check (type in ('stock','ventes','produits'));

do $$ declare t text; begin
  foreach t in array array['bar_fiches','bar_fiche_lignes'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists bar_admin_all on %I', t);
    execute format('create policy bar_admin_all on %I for all to authenticated using (bar_is_admin()) with check (bar_is_admin())', t);
  end loop;
end $$;

insert into bar_reglages(cle, valeur) values ('ratio_cible', '25') on conflict (cle) do nothing;

select 'ok' as resultat;
