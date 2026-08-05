-- Simplifie le scoring : plus de points ni de bonus de rapidité.
-- Une question est juste (1) ou fausse (0), y compris pour les questions
-- à choix multiples (il faut cocher exactement les bonnes cases, sans
-- crédit partiel). participants.score_total devient donc simplement le
-- nombre de bonnes réponses, ce qui n'impacte pas classement/mon_resultat
-- qui trient déjà sur cette colonne.
-- Exécuter dans l'éditeur SQL Supabase.

CREATE OR REPLACE FUNCTION public.repondre(p_participant uuid, p_question uuid, p_options uuid[] DEFAULT '{}'::uuid[], p_texte text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  TOLERANCE_MS constant int := 2000;  -- absorbe la latence réseau
  p            public.participants%rowtype;
  s            public.sessions%rowtype;
  q            public.questions%rowtype;
  ecoule_ms    int;
  hors_delai   boolean := false;
  nb_correctes int;
  nb_bonnes    int;
  nb_mauvaises int;
  correcte     boolean := false;
  choisies     uuid[] := coalesce(p_options, '{}');
begin
  select * into p from public.participants where id = p_participant for update;
  if not found or p.user_id is distinct from auth.uid() then
    raise exception 'Participant inconnu';
  end if;
  if p.question_servie_id is distinct from p_question then
    raise exception 'Cette question ne vous a pas été servie';
  end if;
  if exists (select 1 from public.reponses
              where participant_id = p.id and question_id = p_question) then
    raise exception 'Réponse déjà enregistrée';
  end if;

  select * into s from public.sessions where id = p.session_id;
  select * into q from public.questions where id = p_question;

  ecoule_ms := greatest(0, (extract(epoch from (now() - p.servie_le)) * 1000)::int);
  if ecoule_ms > q.duree_sec * 1000 + TOLERANCE_MS then
    hors_delai := true;
    ecoule_ms  := q.duree_sec * 1000;
  end if;

  if not hors_delai then
    if q.type = 'texte' then
      correcte := exists (
                    select 1 from unnest(coalesce(q.reponses_texte, '{}')) r
                     where public.normaliser(r) = public.normaliser(p_texte)
                       and public.normaliser(r) <> ''
                  );
    else
      select count(*) into nb_correctes
        from public.options where question_id = q.id and est_correcte;

      select count(*) filter (where o.est_correcte),
             count(*) filter (where not o.est_correcte)
        into nb_bonnes, nb_mauvaises
        from public.options o
       where o.question_id = q.id and o.id = any (choisies);

      correcte := nb_correctes > 0
                  and nb_bonnes = nb_correctes
                  and nb_mauvaises = 0
                  and array_length(choisies, 1) = nb_correctes;
    end if;
  end if;

  insert into public.reponses (
    participant_id, question_id, options_choisies, texte_saisi,
    est_correcte, points_obtenus, temps_ms, hors_delai
  )
  values (p.id, q.id, choisies, p_texte, correcte, (correcte::int), ecoule_ms, hors_delai);

  update public.participants
     set score_total    = score_total + (correcte::int),
         temps_total_ms = temps_total_ms + ecoule_ms,
         index_courant  = index_courant + 1,
         termine_le     = case
                            when index_courant + 1 >= coalesce(array_length(ordre_questions, 1), 0)
                            then now() else null end
   where id = p.id
  returning * into p;

  return json_build_object(
    'est_correcte', correcte,
    'hors_delai', hors_delai,
    'score_total', p.score_total,
    'fini', p.termine_le is not null,
    -- la correction n'est renvoyée que si l'animateur l'a autorisée
    'correction', case when s.correction_immediate then
      json_build_object(
        'bonnes_options', (select coalesce(json_agg(o.id), '[]'::json)
                             from public.options o
                            where o.question_id = q.id and o.est_correcte),
        'explication', q.explication,
        'reference_biblique', q.reference_biblique
      ) else null end
  );
end;
$function$
