-- Outil Bar 1.13 — script 06 : ingrédients hors stock Bizzon dans les fiches (citron vert, menthe fraîche…)
-- À coller une fois dans Supabase > SQL Editor > Run. Relançable sans dommage.
alter table bar_fiche_lignes add column if not exists prix_unitaire numeric(12,4);  -- prix d'achat HT saisi à la main (€/kg, €/L ou €/pièce)
alter table bar_fiche_lignes add column if not exists unite_libre text check (unite_libre in ('g','cl','pièce'));
select 'ok' as resultat;
