-- =====================================================================
-- Outil Bar 1.13 — script 01 : tables, sécurité, fonctions, données de départ
-- Projet Supabase partagé avec TableFlow. Toutes les tables commencent par bar_
-- et aucune table existante de TableFlow n'est modifiée.
-- À coller une seule fois dans Supabase > SQL Editor > New query > Run.
-- Le script peut être relancé sans dommage (if not exists / on conflict).
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- 1. Rôles : qui est admin, quel compte est la tablette du bar
-- ---------------------------------------------------------------------
create table if not exists bar_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role    text not null check (role in ('admin','tablette')),
  nom     text
);

create or replace function bar_role() returns text
language sql stable security definer set search_path = public as $$
  select role from bar_roles where user_id = auth.uid()
$$;

create or replace function bar_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from bar_roles where user_id = auth.uid()), false)
$$;

-- ---------------------------------------------------------------------
-- 2. Équipe bar (code à 4 chiffres choisi par chacun, stocké chiffré)
-- ---------------------------------------------------------------------
create table if not exists bar_staff (
  id        serial primary key,
  prenom    text not null unique,
  pin_hash  text,
  actif     boolean not null default true,
  cree_le   timestamptz not null default now()
);

create table if not exists bar_pin_echecs (
  id      bigserial primary key,
  le      timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3. Articles contrôlés (articles à acheter, dépôt ECONOMAT GENERAL)
-- ---------------------------------------------------------------------
create table if not exists bar_articles (
  id            serial primary key,
  nom_bizzon    text not null unique,          -- nom exact dans l'export Stock théorique
  code_ac       text,
  nom_court     text not null,                 -- nom affiché sur le téléphone
  unite         text not null check (unite in ('litres','bouteilles','pieces')),
  type          text not null check (type in ('prioritaire','canette','rotation','hors')),
  freq_semaine  int  not null default 0,       -- nombre de comptages garantis par semaine
  emplacements  text[] not null default array['eco','bar'],
  ordre         int  not null default 100,
  actif         boolean not null default true
);

-- ---------------------------------------------------------------------
-- 4. Imports des exports Bizzon
-- ---------------------------------------------------------------------
create table if not exists bar_imports (
  id             bigserial primary key,
  type           text not null check (type in ('stock','ventes')),
  fichier        text,
  exporte_le     timestamptz,          -- heure de l'export Bizzon (sert de référence au comptage)
  periode_debut  date,
  periode_fin    date,
  nb_lignes      int,
  importe_le     timestamptz not null default now(),
  importe_par    uuid references auth.users(id)
);

create table if not exists bar_stock_theo (
  id          bigserial primary key,
  import_id   bigint not null references bar_imports(id) on delete cascade,
  nom_bizzon  text not null,
  code_ac     text,
  unite       text,
  famille     text,
  qte_initiale numeric, recu numeric, vendu numeric, transferts numeric, ajustements numeric,
  prevu       numeric,
  prix        numeric,
  valeur      numeric
);
create index if not exists bar_stock_theo_import on bar_stock_theo(import_id);
create index if not exists bar_stock_theo_nom on bar_stock_theo(nom_bizzon);

create table if not exists bar_ventes (
  id            bigserial primary key,
  import_id     bigint not null references bar_imports(id) on delete cascade,
  date_vente    date not null,
  article       text not null,
  groupe        text, famille text, sous_famille text,
  centre        text,
  point_vente   text,
  quantite      numeric,
  brut_ht       numeric, remises numeric, net_ht numeric
);
create index if not exists bar_ventes_date on bar_ventes(date_vente);

-- ---------------------------------------------------------------------
-- 5. Tirage, comptages
-- ---------------------------------------------------------------------
create table if not exists bar_tirages (
  date_jour   date not null,
  article_id  int  not null references bar_articles(id),
  motif       text not null check (motif in ('prioritaire','canette','rotation','recontrole','manuel')),
  primary key (date_jour, article_id)
);

create table if not exists bar_comptages (
  id               bigserial primary key,
  date_jour        date not null unique,
  par              uuid references auth.users(id),
  commence_le      timestamptz not null default now(),
  valide_le        timestamptz,
  import_stock_id  bigint references bar_imports(id)
);

create table if not exists bar_comptage_lignes (
  id           bigserial primary key,
  comptage_id  bigint not null references bar_comptages(id) on delete cascade,
  article_id   int    not null references bar_articles(id),
  emplacement  text   not null check (emplacement in ('eco','bar','ms')),
  quantite     numeric not null,
  recompte     boolean not null default false,
  saisi_le     timestamptz not null default now(),
  unique (comptage_id, article_id, emplacement, recompte)
);

create table if not exists bar_causes (
  comptage_id  bigint not null references bar_comptages(id) on delete cascade,
  article_id   int    not null references bar_articles(id),
  cause        text   not null,
  note         text,
  primary key (comptage_id, article_id)
);

-- ---------------------------------------------------------------------
-- 6. Pertes
-- ---------------------------------------------------------------------
create table if not exists bar_pertes (
  id            bigserial primary key,
  cree_le       timestamptz not null default now(),
  staff_id      int references bar_staff(id),
  admin_id      uuid references auth.users(id),
  nom_bizzon    text not null,
  quantite      numeric not null check (quantite > 0),
  motif         text not null check (motif in ('Casse','Périmé ou abîmé','Erreur de préparation','Retour client','Autre')),
  commentaire   text,
  statut        text not null default 'a_valider' check (statut in ('a_valider','validee','refusee')),
  traite_par    uuid references auth.users(id),
  traite_le     timestamptz,
  reporte_bizzon date          -- rempli quand le transfert vers PERTE ET CASSE est fait
);

-- ---------------------------------------------------------------------
-- 7. Tâches quotidiennes et hebdomadaires
-- ---------------------------------------------------------------------
create table if not exists bar_taches (
  id            serial primary key,
  libelle       text not null,
  detail        text,
  frequence     text not null check (frequence in ('quotidienne','hebdomadaire')),
  moment        text check (moment in ('ouverture','midi','soir','fermeture')),
  jour_semaine  int  check (jour_semaine between 1 and 7),   -- 1 = lundi, pour l'hebdomadaire
  heure_limite  time not null,
  ordre         int  not null default 100,
  actif         boolean not null default true,
  unique (libelle, frequence)
);

create table if not exists bar_taches_validations (
  id          bigserial primary key,
  tache_id    int  not null references bar_taches(id),
  date_jour   date not null,
  staff_id    int  references bar_staff(id),
  admin_id    uuid references auth.users(id),
  valide_le   timestamptz not null default now(),
  unique (tache_id, date_jour)
);

-- ---------------------------------------------------------------------
-- 8. Calendrier, réglages, durées après ouverture
-- ---------------------------------------------------------------------
create table if not exists bar_calendrier (
  date_jour  date primary key,
  actif      boolean not null,          -- exception au fonctionnement par défaut
  heure      time
);

create table if not exists bar_reglages (
  cle     text primary key,
  valeur  jsonb not null
);

create table if not exists bar_dlc (
  id            serial primary key,
  produit       text not null unique,
  duree         text,
  conservation  text not null default 'Frigo' check (conservation in ('Frigo','Ambiant'))
);

-- ---------------------------------------------------------------------
-- 9. Sécurité : seuls les admins lisent et écrivent les tables.
--    La tablette passe uniquement par les fonctions ci-dessous.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['bar_roles','bar_staff','bar_pin_echecs','bar_articles','bar_imports','bar_stock_theo',
    'bar_ventes','bar_tirages','bar_comptages','bar_comptage_lignes','bar_causes','bar_pertes','bar_taches',
    'bar_taches_validations','bar_calendrier','bar_reglages','bar_dlc'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists bar_admin_all on %I', t);
    execute format('create policy bar_admin_all on %I for all to authenticated using (bar_is_admin()) with check (bar_is_admin())', t);
  end loop;
end $$;

-- Chacun peut lire sa propre ligne de rôle (pour savoir quel écran afficher)
drop policy if exists bar_roles_self on bar_roles;
create policy bar_roles_self on bar_roles for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 10. Fonctions de la tablette (code personnel vérifié côté serveur)
-- ---------------------------------------------------------------------
create or replace function bar_check_device() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(bar_role(),'') not in ('tablette','admin') then
    raise exception 'Appareil non autorisé';
  end if;
end $$;

-- Identifie un employé par son code. Renvoie -1 si bloqué (8 erreurs en 10 min), null si code inconnu.
-- Pas d'exception ici : l'erreur doit rester enregistrée pour que le blocage fonctionne.
create or replace function bar_identifier(p_pin text) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare v_id int;
begin
  perform bar_check_device();
  if (select count(*) from bar_pin_echecs where le > now() - interval '10 minutes') >= 8 then
    return -1;
  end if;
  select id into v_id from bar_staff
   where actif and pin_hash is not null and pin_hash = extensions.crypt(p_pin, pin_hash);
  if v_id is null then
    insert into bar_pin_echecs default values;
  end if;
  return v_id;
end $$;

create or replace function bar_pin_erreur(v int) returns text language sql immutable as $$
  select case when v is null then 'ERREUR:Code inconnu'
              when v = -1 then 'ERREUR:Trop de codes erronés. Réessaie dans 10 minutes.' end
$$;

-- Liste des prénoms pour l'écran « Choisir mon code »
create or replace function bar_staff_liste() returns table(id int, prenom text, a_un_code boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  perform bar_check_device();
  return query select s.id, s.prenom, s.pin_hash is not null from bar_staff s where s.actif order by s.prenom;
end $$;

-- Première connexion : l'employé choisit son code (une seule fois ; un admin peut le réinitialiser)
create or replace function bar_definir_code(p_staff int, p_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform bar_check_device();
  if p_pin !~ '^[0-9]{4}$' then raise exception 'Le code doit faire 4 chiffres'; end if;
  if p_pin in ('0000','1111','2222','3333','4444','5555','6666','7777','8888','9999','1234','4321','0123','9876','1212','2580')
    then raise exception 'Code trop simple, choisis-en un autre'; end if;
  if exists (select 1 from bar_staff where pin_hash is not null and pin_hash = extensions.crypt(p_pin, pin_hash))
    then raise exception 'Code déjà pris, choisis-en un autre'; end if;
  update bar_staff set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf'))
   where id = p_staff and pin_hash is null;
  if not found then raise exception 'Ce prénom a déjà un code'; end if;
end $$;

-- Tâches du jour (quotidiennes + hebdomadaires du jour) avec leur état
create or replace function bar_taches_du_jour(p_date date default (now() at time zone 'Europe/Paris')::date)
returns table(id int, libelle text, detail text, frequence text, moment text, jour_semaine int,
              heure_limite time, ordre int, fait_par text, fait_le timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform bar_check_device();
  return query
  select t.id, t.libelle, t.detail, t.frequence, t.moment, t.jour_semaine, t.heure_limite, t.ordre,
         coalesce(s.prenom, r.nom), v.valide_le
    from bar_taches t
    left join bar_taches_validations v
      on v.tache_id = t.id
     and v.date_jour = case when t.frequence = 'quotidienne' then p_date
                            else p_date - (extract(isodow from p_date)::int - t.jour_semaine) end
    left join bar_staff s on s.id = v.staff_id
    left join bar_roles r on r.user_id = v.admin_id
   where t.actif
   order by t.frequence, t.jour_semaine nulls first, t.ordre;
end $$;

create or replace function bar_valider_tache(p_pin text, p_tache int) returns text
language plpgsql security definer set search_path = public as $$
declare v_staff int; v_freq text; v_jour int; v_date date := (now() at time zone 'Europe/Paris')::date; v_prenom text;
begin
  v_staff := bar_identifier(p_pin);
  if v_staff is null or v_staff = -1 then return bar_pin_erreur(v_staff); end if;
  select frequence, jour_semaine into v_freq, v_jour from bar_taches where id = p_tache and actif;
  if v_freq is null then raise exception 'Tâche inconnue'; end if;
  if v_freq = 'hebdomadaire' then v_date := v_date - (extract(isodow from v_date)::int - v_jour); end if;
  insert into bar_taches_validations(tache_id, date_jour, staff_id) values (p_tache, v_date, v_staff)
  on conflict (tache_id, date_jour) do nothing;
  select prenom into v_prenom from bar_staff where id = v_staff;
  return v_prenom;
end $$;

-- Recherche d'article pour la déclaration de perte (noms et unités seulement, pas de prix)
create or replace function bar_articles_recherche(p_q text)
returns table(nom_bizzon text, unite text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform bar_check_device();
  return query
  select st.nom_bizzon, max(st.unite)
    from bar_stock_theo st
   where st.import_id = (select max(i.id) from bar_imports i where i.type = 'stock')
     and st.nom_bizzon ilike '%' || p_q || '%'
   group by st.nom_bizzon
   order by st.nom_bizzon
   limit 8;
end $$;

create or replace function bar_declarer_perte(p_pin text, p_nom text, p_quantite numeric, p_motif text, p_commentaire text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare v_staff int; v_prenom text;
begin
  v_staff := bar_identifier(p_pin);
  if v_staff is null or v_staff = -1 then return bar_pin_erreur(v_staff); end if;
  if p_motif = 'Autre' and coalesce(trim(p_commentaire),'') = '' then
    raise exception 'Pour le motif « Autre », un commentaire est obligatoire';
  end if;
  insert into bar_pertes(staff_id, nom_bizzon, quantite, motif, commentaire)
  values (v_staff, p_nom, p_quantite, p_motif, p_commentaire);
  select prenom into v_prenom from bar_staff where id = v_staff;
  return v_prenom;
end $$;

revoke all on function bar_identifier(text) from public, anon;
grant execute on function bar_staff_liste(), bar_definir_code(int,text), bar_taches_du_jour(date),
  bar_valider_tache(text,int), bar_articles_recherche(text), bar_declarer_perte(text,text,numeric,text,text),
  bar_role(), bar_is_admin() to authenticated;
revoke execute on function bar_staff_liste(), bar_definir_code(int,text), bar_taches_du_jour(date),
  bar_valider_tache(text,int), bar_articles_recherche(text), bar_declarer_perte(text,text,numeric,text,text) from anon;

-- ---------------------------------------------------------------------
-- 11. Données de départ
-- ---------------------------------------------------------------------
insert into bar_staff(prenom) values
 ('Florian'),('Fidèle'),('César'),('Laurie'),('Abdel'),('Franck'),('Patricia'),('Nicolas')
on conflict (prenom) do nothing;

-- Liste prioritaire : 2 comptages par semaine
insert into bar_articles(nom_bizzon, code_ac, nom_court, unite, type, freq_semaine, emplacements, ordre) values
 ('SANTIAGO DE CUBA CARTA BLANCA 70CL','AC05202876','Santiago Carta Blanca','bouteilles','prioritaire',2,array['eco','bar'],10),
 ('SANTIAGO DE CUBA 8 ANS 70CL','AC05202877','Santiago 8 ans','bouteilles','prioritaire',2,array['eco','bar'],11),
 ('RHUM SANTIAGO DE CUBA 12 ANS','AC05202879','Santiago 12 ans','bouteilles','prioritaire',2,array['eco','bar'],12),
 ('APEROL','AC04930126','Aperol','bouteilles','prioritaire',2,array['eco','bar'],13),
 ('GIN BOMBAY SAPHIRE 70CL','AC0359598','Bombay Sapphire','bouteilles','prioritaire',2,array['eco','bar'],14),
 ('JACK DANIELS 70CL','AC0359706','Jack Daniel''s','bouteilles','prioritaire',2,array['eco','bar'],15),
 ('RHUM DILLON BLANC 70CL','AC4696128','Dillon blanc','bouteilles','prioritaire',2,array['eco','bar'],16),
 ('VODKA ABSOLUT 70CL','AC05741519','Absolut','bouteilles','prioritaire',2,array['eco','bar'],17),
 ('PULCO CITRON VERT 70CL','AC05648119','Pulco citron vert','bouteilles','prioritaire',2,array['eco','bar'],18),
 ('PERRIER 75CL VP','AC0360132','Perrier 75 cl VP','bouteilles','prioritaire',2,array['eco','bar'],19),
 ('HEINEKEN FUT DAVID 20L','AC0359986','Heineken fût 20 L','litres','prioritaire',2,array['eco','bar'],1),
 ('AFFLIGEM FUT DAVID 20L','AC0359990','Affligem fût 20 L','litres','prioritaire',2,array['eco','bar'],2),
 ('GIN GIBSON 70CL','AC0359601','Gin Gibson','bouteilles','prioritaire',2,array['eco','bar'],20)
on conflict (nom_bizzon) do nothing;

-- Canettes : tous les jours, trois emplacements
insert into bar_articles(nom_bizzon, code_ac, nom_court, unite, type, freq_semaine, emplacements, ordre) values
 ('FANTA ORANGE 33CL SLIM','AC05648097','Fanta Slim','pieces','canette',5,array['eco','bar','ms'],50),
 ('FUZETEA PECHE 33CL SLIM','AC05473603','Fuzetea Slim','pieces','canette',5,array['eco','bar','ms'],51),
 ('COCA COLA 33CL SLIM','AC05473600','Coca Slim','pieces','canette',5,array['eco','bar','ms'],52),
 ('COCA COLA ZERO 33CL SLIM','AC05473601','Coca Zero Slim','pieces','canette',5,array['eco','bar','ms'],53),
 ('PERRIER 33CL SLIM','AC0360164','Perrier Slim','pieces','canette',5,array['eco','bar','ms'],54),
 ('HEINEKEN BOITE 33 CL','AC0359724','Heineken Slim','pieces','canette',5,array['eco','bar','ms'],55),
 ('1664 33CL SLIM','AC0359730','1664 Slim','pieces','canette',5,array['eco','bar','ms'],56),
 ('HEINEKEN 00 33CL CL BOITE','AC0359894','Heineken 0.0 Slim','pieces','canette',5,array['eco','bar','ms'],57)
on conflict (nom_bizzon) do nothing;

insert into bar_taches(libelle, detail, frequence, moment, jour_semaine, heure_limite, ordre) values
 ('Contrôle des dates : frigo bar, frigo Mshop, produits ouverts','Produit périmé : retirer, puis déclarer la perte','quotidienne','ouverture',null,'10:00',1),
 ('Étiquetage des produits ouverts du jour','Durées dans la fiche produits','quotidienne','ouverture',null,'10:00',2),
 ('Relevé des températures des frigos','Frigo bar, frigo Mshop','quotidienne','ouverture',null,'10:00',3),
 ('Tour d''étage du midi','Ramasser les plateaux room service','quotidienne','midi',null,'14:30',4),
 ('Tour d''étage du soir','Ramasser les plateaux room service','quotidienne','soir',null,'21:30',5),
 ('Plans de travail et éviers nettoyés, désinfectés',null,'quotidienne','fermeture',null,'23:30',6),
 ('Becs de tireuse et égouttoirs nettoyés',null,'quotidienne','fermeture',null,'23:30',7),
 ('Machine à café : nettoyage de fin de service',null,'quotidienne','fermeture',null,'23:30',8),
 ('Poubelles vidées, sol du bar nettoyé',null,'quotidienne','fermeture',null,'23:30',9),
 ('Frigos rangés, premier entré premier sorti',null,'quotidienne','fermeture',null,'23:30',10),
 ('Nettoyage des lignes de bière','Fréquence à confirmer avec le brasseur','hebdomadaire',null,1,'23:30',1),
 ('Frigos nettoyés à fond','Intérieur et joints','hebdomadaire',null,2,'23:30',2),
 ('Machine à glaçons nettoyée et désinfectée',null,'hebdomadaire',null,3,'23:30',3),
 ('Réserve bar : étagères et rangement',null,'hebdomadaire',null,4,'23:30',4)
on conflict (libelle, frequence) do nothing;

insert into bar_reglages(cle, valeur) values
 ('seuils', '{"litres":5,"bouteilles":0.2,"pieces":0,"euros":10}'),
 ('comptage', '{"heure_semaine":"08:00","heure_weekend":"10:00","articles_bar_par_jour":8,"jours_semaine":[1,2,3,4,5]}'),
 ('exclusions_ventes', '{"centres":["PETIT DEJEUNER OURSINADE"],"points_vente":["BANQUET"]}')
on conflict (cle) do nothing;

insert into bar_dlc(produit) values
 ('Purée de fruits'),('Sirops'),('Jus de fruits (brique)'),('Lait'),('Crème liquide'),
 ('Agrumes coupés'),('Vin ouvert (bouteille)'),('Vermouths')
on conflict (produit) do nothing;

-- ---------------------------------------------------------------------
-- 12. Rôles : Antoine et Christophe admins, compte tablette
--     (reprend les comptes TableFlow existants ; relancer ce bloc après
--      avoir créé le compte de la tablette dans Authentication > Users)
-- ---------------------------------------------------------------------
insert into bar_roles(user_id, role, nom)
select id, 'admin', case when email ilike 'aforster%' then 'Antoine' else 'Christophe' end
  from auth.users where email ilike 'aforster%' or email ilike 'cmolinaroli%'
on conflict (user_id) do update set role = 'admin';

insert into bar_roles(user_id, role, nom)
select id, 'tablette', 'Tablette bar' from auth.users where email ilike 'tablette.bar%'
on conflict (user_id) do update set role = 'tablette';

-- Vérification : doit afficher Antoine et Christophe (et la tablette si elle existe)
select r.nom, r.role, u.email from bar_roles r join auth.users u on u.id = r.user_id;
