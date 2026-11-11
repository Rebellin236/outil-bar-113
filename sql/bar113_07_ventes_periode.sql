-- =====================================================================
-- Outil Bar 1.13 — script 07 : ventes sur une période (mois, trimestre, année) pour le menu engineering
-- À coller une fois dans Supabase > SQL Editor > Run. Relançable sans dommage.
-- Rangées à part : elles ne se mélangent jamais au rapport de ventes jour par jour.
-- =====================================================================
create table if not exists bar_ventes_periode (
  id            bigserial primary key,
  import_id     bigint not null references bar_imports(id) on delete cascade,
  date_vente    date,
  article       text not null,
  groupe        text, famille text, sous_famille text,
  centre        text,
  point_vente   text,
  quantite      numeric,
  brut_ht       numeric, remises numeric, net_ht numeric
);
create index if not exists bar_ventes_periode_imp on bar_ventes_periode(import_id);

alter table bar_imports drop constraint if exists bar_imports_type_check;
alter table bar_imports add constraint bar_imports_type_check check (type in ('stock','ventes','produits','ventes_periode'));

alter table bar_ventes_periode enable row level security;
drop policy if exists bar_admin_all on bar_ventes_periode;
create policy bar_admin_all on bar_ventes_periode for all to authenticated using (bar_is_admin()) with check (bar_is_admin());

select 'ok' as resultat;
