-- =====================================================================
-- Outil Bar 1.13 — script 03 : comptage (calendrier, soirée salsa, recompte)
-- À coller une fois dans Supabase > SQL Editor > Run. Relançable sans dommage.
-- =====================================================================

-- Calendrier : une ligne = une exception au fonctionnement par défaut (lun-ven actifs, week-end inactif)
alter table bar_calendrier alter column actif drop not null;
alter table bar_calendrier add column if not exists salsa boolean not null default false;

-- Comptage : articles à recompter tout de suite, tirage terminé
alter table bar_comptages add column if not exists recompte_ids int[] not null default '{}';
alter table bar_comptages add column if not exists tirage_ok boolean not null default false;

-- Articles comptés d'office le lendemain d'une soirée salsa
insert into bar_reglages(cle, valeur) values
 ('salsa_articles', '["RHUM HAVANA CLUB 3 ANS 70CL","RHUM HAVANA CLUB 7 ANEJO 70CL","RHUM DILLON BLANC 70CL"]'),
 ('rotation_familles', '["APERITIF ALCOOL","BIERE PRESSION/BOUTEILLE","SOFT/EAUX MINERALES","GRANDS VINS","CHAMPAGNES","VINS BLANCS BTLE","VINS ROSES BTLE","VINS ROUGES BTLE","37.5CL BLANC/ROUGE/ROSE","VIN PICHET"]')
on conflict (cle) do nothing;

select 'ok' as resultat;
