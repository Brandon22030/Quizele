-- Pilotage question par question par l'animateur
-- Exécuter dans l'éditeur SQL Supabase

-- 1. Colonnes de suivi de révélation sur les sessions
alter table public.sessions
  add column if not exists reponses_reveles_le timestamptz,
  add column if not exists resultats_reveles boolean not null default false;

-- 2. L'animateur révèle la correction de la question en cours à tous les participants
create or replace function public.valider_question(p_session uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quiz_id uuid;
begin
  select quiz_id into v_quiz_id from public.sessions where id = p_session;
  if v_quiz_id is null then
    raise exception 'Session introuvable';
  end if;
  if not public.est_auteur_du_quiz(v_quiz_id) then
    raise exception 'Non autorisé';
  end if;

  update public.sessions
  set reponses_reveles_le = now()
  where id = p_session;
end;
$$;

grant execute on function public.valider_question(uuid) to authenticated;

-- 3. Réinitialise la révélation quand l'animateur pousse une nouvelle question
create or replace function public.reinitialiser_revele(p_session uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quiz_id uuid;
begin
  select quiz_id into v_quiz_id from public.sessions where id = p_session;
  if v_quiz_id is null then
    raise exception 'Session introuvable';
  end if;
  if not public.est_auteur_du_quiz(v_quiz_id) then
    raise exception 'Non autorisé';
  end if;

  update public.sessions
  set reponses_reveles_le = null
  where id = p_session;
end;
$$;

grant execute on function public.reinitialiser_revele(uuid) to authenticated;

-- 4. L'animateur révèle les scores finaux à tous les participants
create or replace function public.terminer_session(p_session uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quiz_id uuid;
begin
  select quiz_id into v_quiz_id from public.sessions where id = p_session;
  if v_quiz_id is null then
    raise exception 'Session introuvable';
  end if;
  if not public.est_auteur_du_quiz(v_quiz_id) then
    raise exception 'Non autorisé';
  end if;

  update public.sessions
  set resultats_reveles = true,
      reponses_reveles_le = now()
  where id = p_session;
end;
$$;

grant execute on function public.terminer_session(uuid) to authenticated;
