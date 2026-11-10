-- Outil Bar 1.13 — script 04 : Red Bull ajouté aux canettes comptées tous les jours
insert into bar_articles (nom_bizzon, code_ac, nom_court, unite, type, freq_semaine, emplacements, ordre, actif)
values ('RED BULL BOITE 25CL', 'AC0326927', 'Red Bull', 'pieces', 'canette', 5, array['eco','bar','ms'], 58, true)
on conflict (nom_bizzon) do update set type = 'canette', nom_court = 'Red Bull', unite = 'pieces',
  freq_semaine = 5, emplacements = array['eco','bar','ms'], ordre = 58, actif = true;
select nom_court, type from bar_articles where type = 'canette' order by ordre;
