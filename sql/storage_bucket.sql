-- Créer le bucket public "covers" s'il n'existe pas
insert into storage.buckets (id, name, public)
values ('covers', 'covers', true)
on conflict (id) do update set public = true;

-- Politique : lecture publique des images de couverture
create policy "Lecture publique des couvertures"
on storage.objects
for select
to public
using (bucket_id = 'covers');

-- Politique : un utilisateur authentifié peut uploader dans son propre dossier
-- Le chemin envoyé par l'application est : <user_id>/<uuid>.<ext>
create policy "Utilisateurs peuvent uploader leurs couvertures"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'covers'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Politique : un utilisateur authentifié peut supprimer ses propres images
create policy "Utilisateurs peuvent supprimer leurs couvertures"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'covers'
  and (storage.foldername(name))[1] = auth.uid()::text
);
