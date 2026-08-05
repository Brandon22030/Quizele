-- Empêche les utilisateurs anonymes (participants) d'écrire sur les tables
-- réservées aux créateurs de quiz, même s'ils portent le rôle "authenticated".
-- Exécuter dans l'éditeur SQL Supabase, après avoir activé Anonymous Sign-Ins.
--
-- Ces policies sont "restrictive" : elles s'ajoutent (AND) aux policies
-- permissives existantes sans les remplacer. Elles ne concernent que
-- insert/update/delete, jamais select, pour ne pas casser la lecture
-- publique des quiz partagés par lien.

-- 1. quizzes
drop policy if exists "Bloquer écriture anonyme sur quizzes" on public.quizzes;
create policy "Bloquer écriture anonyme sur quizzes"
on public.quizzes as restrictive
for insert
to authenticated
with check ((select (auth.jwt()->>'is_anonymous')::boolean) is false);

drop policy if exists "Bloquer modification anonyme sur quizzes" on public.quizzes;
create policy "Bloquer modification anonyme sur quizzes"
on public.quizzes as restrictive
for update
to authenticated
using ((select (auth.jwt()->>'is_anonymous')::boolean) is false);

drop policy if exists "Bloquer suppression anonyme sur quizzes" on public.quizzes;
create policy "Bloquer suppression anonyme sur quizzes"
on public.quizzes as restrictive
for delete
to authenticated
using ((select (auth.jwt()->>'is_anonymous')::boolean) is false);

-- 2. questions
drop policy if exists "Bloquer écriture anonyme sur questions" on public.questions;
create policy "Bloquer écriture anonyme sur questions"
on public.questions as restrictive
for insert
to authenticated
with check ((select (auth.jwt()->>'is_anonymous')::boolean) is false);

drop policy if exists "Bloquer modification anonyme sur questions" on public.questions;
create policy "Bloquer modification anonyme sur questions"
on public.questions as restrictive
for update
to authenticated
using ((select (auth.jwt()->>'is_anonymous')::boolean) is false);

drop policy if exists "Bloquer suppression anonyme sur questions" on public.questions;
create policy "Bloquer suppression anonyme sur questions"
on public.questions as restrictive
for delete
to authenticated
using ((select (auth.jwt()->>'is_anonymous')::boolean) is false);

-- 3. options
drop policy if exists "Bloquer écriture anonyme sur options" on public.options;
create policy "Bloquer écriture anonyme sur options"
on public.options as restrictive
for insert
to authenticated
with check ((select (auth.jwt()->>'is_anonymous')::boolean) is false);

drop policy if exists "Bloquer modification anonyme sur options" on public.options;
create policy "Bloquer modification anonyme sur options"
on public.options as restrictive
for update
to authenticated
using ((select (auth.jwt()->>'is_anonymous')::boolean) is false);

drop policy if exists "Bloquer suppression anonyme sur options" on public.options;
create policy "Bloquer suppression anonyme sur options"
on public.options as restrictive
for delete
to authenticated
using ((select (auth.jwt()->>'is_anonymous')::boolean) is false);

-- 4. sessions (les écritures légitimes passent par des RPC security definer,
-- mais on bloque quand même l'accès direct à la table par précaution)
drop policy if exists "Bloquer écriture anonyme sur sessions" on public.sessions;
create policy "Bloquer écriture anonyme sur sessions"
on public.sessions as restrictive
for insert
to authenticated
with check ((select (auth.jwt()->>'is_anonymous')::boolean) is false);

drop policy if exists "Bloquer modification anonyme sur sessions" on public.sessions;
create policy "Bloquer modification anonyme sur sessions"
on public.sessions as restrictive
for update
to authenticated
using ((select (auth.jwt()->>'is_anonymous')::boolean) is false);

drop policy if exists "Bloquer suppression anonyme sur sessions" on public.sessions;
create policy "Bloquer suppression anonyme sur sessions"
on public.sessions as restrictive
for delete
to authenticated
using ((select (auth.jwt()->>'is_anonymous')::boolean) is false);

-- 5. Bucket de stockage "covers" : empêche un anonyme d'uploader/supprimer
-- des fichiers dans son propre dossier <anon_uid>/...
drop policy if exists "Bloquer upload anonyme des couvertures" on storage.objects;
create policy "Bloquer upload anonyme des couvertures"
on storage.objects as restrictive
for insert
to authenticated
with check (
  bucket_id != 'covers'
  or (select (auth.jwt()->>'is_anonymous')::boolean) is false
);

drop policy if exists "Bloquer suppression anonyme des couvertures" on storage.objects;
create policy "Bloquer suppression anonyme des couvertures"
on storage.objects as restrictive
for delete
to authenticated
using (
  bucket_id != 'covers'
  or (select (auth.jwt()->>'is_anonymous')::boolean) is false
);
