-- Outil Bar 1.13 — script 08 : Sprite et Red Bull dans les canettes comptées tous les jours (économat, bar, Mshop)
-- Relançable sans dommage.
insert into bar_articles (nom_bizzon, code_ac, nom_court, unite, type, freq_semaine, emplacements, ordre, actif) values
 ('RED BULL BOITE 25CL', 'AC0326927',  'Red Bull',    'pieces', 'canette', 5, array['eco','bar','ms'], 58, true),
 ('SPRITE SLIM 33cl',    'AC05473604', 'Sprite Slim', 'pieces', 'canette', 5, array['eco','bar','ms'], 59, true)
on conflict (nom_bizzon) do update set type = 'canette', nom_court = excluded.nom_court, unite = 'pieces',
  freq_semaine = 5, emplacements = array['eco','bar','ms'], ordre = excluded.ordre, actif = true;
select nom_court, type from bar_articles where type = 'canette' order by ordre;
