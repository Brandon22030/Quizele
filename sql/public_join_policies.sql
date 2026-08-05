-- Politiques pour permettre aux participants anonymes de rejoindre une session
-- Exécuter dans l'éditeur SQL Supabase

-- 1. Lecture publique des sessions en attente ou ouvertes
drop policy if exists "Lecture publique des sessions en cours" on public.sessions;
create policy "Lecture publique des sessions en cours"
on public.sessions
for select
to public
using (statut in ('attente', 'ouverte'));

-- 2. Lecture publique des quizzes publiés ou partagés par lien
drop policy if exists "Lecture publique des quizzes partagés" on public.quizzes;
create policy "Lecture publique des quizzes partagés"
on public.quizzes
for select
to public
using (visibilite in ('lien', 'public') and statut = 'publie');

-- 3. Lecture publique des questions des quizzes partagés
drop policy if exists "Lecture publique des questions" on public.questions;
create policy "Lecture publique des questions"
on public.questions
for select
to public
using (
  quiz_id in (
    select id from public.quizzes
    where visibilite in ('lien', 'public') and statut = 'publie'
  )
);

-- 4. Lecture publique du profil animateur pour les quizzes partagés
drop policy if exists "Lecture publique des profils animateurs" on public.profiles;
create policy "Lecture publique des profils animateurs"
on public.profiles
for select
to public
using (
  id in (
    select auteur_id from public.quizzes
    where visibilite in ('lien', 'public') and statut = 'publie'
  )
);
