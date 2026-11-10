-- Données de développement local uniquement : aucun secret, comptes factices.
-- Rejouable : les lignes existantes sont mises à jour sur place. Pas de INSERT OR REPLACE : il supprime puis
-- réinsère la ligne, ce qui déclencherait les ON DELETE CASCADE (quiz, parties jouées) du compte de démonstration.
INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
VALUES ('seed-user', 'Animateur de démonstration', 'demo@example.invalid', 1, 1767225600000, 1767225600000)
ON CONFLICT(id) DO UPDATE SET name = excluded.name, email = excluded.email, email_verified = excluded.email_verified, updated_at = excluded.updated_at;

INSERT INTO quizzes (id, owner_id, title, description, category, mode, show_correct_answer, shuffle, created_at, updated_at)
VALUES ('seed-quiz', 'seed-user', 'Quiz de démonstration', 'Trois questions pour essayer le jeu.', 'Démonstration', 'together', 1, 0, 1767225600000, 1767225600000)
ON CONFLICT(id) DO UPDATE SET owner_id = excluded.owner_id, title = excluded.title, description = excluded.description,
  category = excluded.category, mode = excluded.mode, show_correct_answer = excluded.show_correct_answer,
  shuffle = excluded.shuffle, updated_at = excluded.updated_at;

DELETE FROM questions WHERE quiz_id = 'seed-quiz';

INSERT INTO questions (id, quiz_id, position, type, prompt, duration_sec, reference, explanation) VALUES
  ('seed-q1', 'seed-quiz', 0, 'single', 'Combien de jours la création a-t-elle duré ?', 20, 'Genèse 1', 'Six jours de travail, puis un jour de repos.'),
  ('seed-q2', 'seed-quiz', 1, 'multiple', 'Lesquels sont des fruits ?', 20, NULL, 'La tomate est botaniquement un fruit.'),
  ('seed-q3', 'seed-quiz', 2, 'true_false', 'Le soleil se lève à l''est.', 10, NULL, NULL);

INSERT INTO options (id, question_id, position, label, is_correct) VALUES
  ('seed-q1a', 'seed-q1', 0, 'Trois', 0),
  ('seed-q1b', 'seed-q1', 1, 'Six', 1),
  ('seed-q1c', 'seed-q1', 2, 'Sept', 0),
  ('seed-q1d', 'seed-q1', 3, 'Quarante', 0),
  ('seed-q2a', 'seed-q2', 0, 'Tomate', 1),
  ('seed-q2b', 'seed-q2', 1, 'Carotte', 0),
  ('seed-q2c', 'seed-q2', 2, 'Pomme', 1),
  ('seed-q2d', 'seed-q2', 3, 'Poireau', 0),
  ('seed-q3a', 'seed-q3', 0, 'Vrai', 1),
  ('seed-q3b', 'seed-q3', 1, 'Faux', 0);
