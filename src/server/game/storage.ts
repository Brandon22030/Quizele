import { gameModeSchema, phaseSchema, type GameMode, type Phase, type QuestionKind, type RankingEntry } from "../../shared/protocol";
import type { QuizDefinition } from "./quiz";
import { shuffleSeeded } from "./shuffle";

// Migrations versionnées : on n'édite jamais une entrée existante, on en ajoute une.
const MIGRATIONS: string[] = [
  `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE questions (
     id TEXT PRIMARY KEY, position INTEGER NOT NULL UNIQUE, kind TEXT NOT NULL, prompt TEXT NOT NULL,
     duration_ms INTEGER NOT NULL, reference TEXT, explanation TEXT
   );
   CREATE TABLE options (
     id TEXT PRIMARY KEY, question_id TEXT NOT NULL REFERENCES questions(id), position INTEGER NOT NULL,
     label TEXT NOT NULL, is_correct INTEGER NOT NULL
   );
   CREATE INDEX options_question ON options(question_id, position);
   CREATE TABLE players (
     id TEXT PRIMARY KEY, pseudo TEXT NOT NULL, pseudo_key TEXT NOT NULL UNIQUE, joined_at INTEGER NOT NULL
   );
   CREATE TABLE answers (
     player_id TEXT NOT NULL, question_id TEXT NOT NULL, option_ids TEXT NOT NULL, received_at INTEGER NOT NULL,
     elapsed_ms INTEGER NOT NULL, correct INTEGER NOT NULL, late INTEGER NOT NULL,
     PRIMARY KEY (player_id, question_id)
   );
   CREATE INDEX answers_question ON answers(question_id);`,
  // Pseudos bannis par exclusion, et seaux à jetons par joueur ou rôle : ils survivent à la fermeture du
  // socket, sinon une reconnexion remettrait le seau à plein.
  `CREATE TABLE banned (pseudo_key TEXT PRIMARY KEY, player_id TEXT NOT NULL);
   CREATE TABLE buckets (
     key TEXT PRIMARY KEY, tokens REAL NOT NULL, at INTEGER NOT NULL, connect_tokens REAL NOT NULL, connect_at INTEGER NOT NULL
   );`,
  // Mode libre : un état d'avancement par joueur. `deadline` (début + durée + tolérance) n'est renseigné que pendant
  // une question : l'alarme du Durable Object est programmée sur la plus proche.
  `CREATE TABLE pstate (
     player_id TEXT PRIMARY KEY, idx INTEGER NOT NULL, phase TEXT NOT NULL, started_at INTEGER NOT NULL,
     duration_ms INTEGER NOT NULL, deadline INTEGER
   );
   CREATE INDEX pstate_deadline ON pstate(deadline);`,
];

export interface BucketState {
  tokens: number;
  at: number;
  connectTokens: number;
  connectAt: number;
}

export interface MetaState {
  code: string | null;
  sid: string;
  lastHostAt: number;
  title: string;
  showCorrectAnswer: boolean;
  phase: Phase;
  index: number;
  startedAt: number;
  durationMs: number;
  finishedAt: number;
  mode: GameMode;
  shuffle: boolean;
  seed: string;
  // Début de l'écriture finale vers D1, 0 si aucune n'est en cours.
  finishingAt: number;
}

export type PlayerPhase = "question" | "revealed" | "done";

export type PlayerState = {
  playerId: string;
  idx: number;
  phase: PlayerPhase;
  startedAt: number;
  durationMs: number;
};

export type StoredQuestion = {
  id: string;
  position: number;
  kind: QuestionKind;
  prompt: string;
  durationMs: number;
  reference: string | null;
  explanation: string | null;
};

export interface StoredOption {
  id: string;
  label: string;
  isCorrect: boolean;
}

export interface StoredAnswer {
  optionIds: string[];
  correct: boolean;
  late: boolean;
}

export class GameStorage {
  constructor(
    private readonly sql: SqlStorage,
    private readonly storage: DurableObjectStorage,
  ) {}

  // Lecture seule : savoir si la partie existe sans rien écrire dans un objet encore vide.
  hasSchema(): boolean {
    return this.sql.exec("SELECT 1 FROM sqlite_master WHERE name = 'meta'").toArray().length > 0;
  }

  migrate(): void {
    this.sql.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
    const row = this.sql.exec<{ version: number }>("SELECT MAX(version) AS version FROM schema_version").one();
    const current = row.version ?? 0;
    for (let version = current; version < MIGRATIONS.length; version += 1) {
      this.storage.transactionSync(() => {
        this.sql.exec(MIGRATIONS[version]!);
        this.sql.exec("INSERT INTO schema_version (version) VALUES (?)", version + 1);
      });
    }
  }

  readMeta(): MetaState {
    const values = new Map<string, string>();
    for (const row of this.sql.exec<{ key: string; value: string }>("SELECT key, value FROM meta")) {
      values.set(row.key, row.value);
    }
    return {
      code: values.get("code") ?? null,
      sid: values.get("sid") ?? "",
      lastHostAt: Number(values.get("last_host_at") ?? 0),
      title: values.get("title") ?? "",
      showCorrectAnswer: values.get("show_correct") === "1",
      phase: phaseSchema.catch("lobby").parse(values.get("phase")),
      index: Number(values.get("idx") ?? 0),
      startedAt: Number(values.get("started_at") ?? 0),
      durationMs: Number(values.get("duration_ms") ?? 0),
      finishedAt: Number(values.get("finished_at") ?? 0),
      mode: gameModeSchema.catch("together").parse(values.get("mode")),
      shuffle: values.get("shuffle") === "1",
      seed: values.get("seed") ?? "",
      finishingAt: Number(values.get("finishing_at") ?? 0),
    };
  }

  writeMeta(entries: Record<string, string | number>): void {
    for (const [key, value] of Object.entries(entries)) {
      this.sql.exec("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, String(value));
    }
  }

  // Mode ensemble : le mélange est appliqué une fois pour toutes ici, la position stockée est l'ordre de la partie
  // (partagé avec la projection). Mode libre : les positions restent celles du quiz, l'ordre est propre à chaque joueur.
  loadQuiz(code: string, sid: string, quiz: QuizDefinition, now: number, seed: string): void {
    const mode = quiz.mode ?? "together";
    const shuffle = quiz.shuffle ?? false;
    const sharedShuffle = mode === "together" && shuffle;
    const questions = sharedShuffle ? shuffleSeeded(quiz.questions, `${seed}:questions`) : quiz.questions;
    this.storage.transactionSync(() => {
      questions.forEach((question, position) => {
        this.sql.exec(
          "INSERT INTO questions (id, position, kind, prompt, duration_ms, reference, explanation) VALUES (?, ?, ?, ?, ?, ?, ?)",
          question.id, position, question.kind, question.prompt, question.durationSec * 1000, question.reference ?? null, question.explanation ?? null,
        );
        const options = sharedShuffle && question.kind !== "true_false" ? shuffleSeeded(question.options, `${seed}:options:${question.id}`) : question.options;
        options.forEach((option, optionPosition) => {
          this.sql.exec(
            "INSERT INTO options (id, question_id, position, label, is_correct) VALUES (?, ?, ?, ?, ?)",
            option.id, question.id, optionPosition, option.label, option.isCorrect ? 1 : 0,
          );
        });
      });
      this.writeMeta({
        code, sid, title: quiz.title, show_correct: quiz.showCorrectAnswer ? 1 : 0, phase: "lobby", idx: 0, last_host_at: now,
        mode, shuffle: shuffle ? 1 : 0, seed,
      });
    });
  }

  questionCount(): number {
    return this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM questions").one().n;
  }

  questionAt(position: number): StoredQuestion | null {
    const row = this.sql
      .exec<{ id: string; position: number; kind: QuestionKind; prompt: string; durationMs: number; reference: string | null; explanation: string | null }>(
        "SELECT id, position, kind, prompt, duration_ms AS durationMs, reference, explanation FROM questions WHERE position = ?",
        position,
      )
      .toArray()[0];
    return row ?? null;
  }

  options(questionId: string): StoredOption[] {
    return this.sql
      .exec<{ id: string; label: string; isCorrect: number }>(
        "SELECT id, label, is_correct AS isCorrect FROM options WHERE question_id = ? ORDER BY position",
        questionId,
      )
      .toArray()
      .map((row) => ({ id: row.id, label: row.label, isCorrect: row.isCorrect === 1 }));
  }

  addPlayer(id: string, pseudo: string, key: string, now: number): "ok" | "taken" | "banned" {
    if (this.sql.exec("SELECT 1 FROM banned WHERE pseudo_key = ?", key).toArray().length > 0) return "banned";
    // La contrainte UNIQUE sur pseudo_key tranche les inscriptions simultanées.
    const cursor = this.sql.exec(
      "INSERT INTO players (id, pseudo, pseudo_key, joined_at) VALUES (?, ?, ?, ?) ON CONFLICT(pseudo_key) DO NOTHING",
      id, pseudo, key, now,
    );
    return cursor.rowsWritten > 0 ? "ok" : "taken";
  }

  // L'exclusion bannit la clé de pseudo pour la partie : le joueur ne revient pas sous le même nom.
  kickPlayer(id: string): boolean {
    return this.storage.transactionSync(() => {
      const row = this.sql.exec<{ key: string }>("SELECT pseudo_key AS key FROM players WHERE id = ?", id).toArray()[0];
      if (!row) return false;
      this.sql.exec("INSERT INTO banned (pseudo_key, player_id) VALUES (?, ?) ON CONFLICT(pseudo_key) DO NOTHING", row.key, id);
      this.sql.exec("DELETE FROM answers WHERE player_id = ?", id);
      this.sql.exec("DELETE FROM pstate WHERE player_id = ?", id);
      this.sql.exec("DELETE FROM players WHERE id = ?", id);
      return true;
    });
  }

  isBanned(playerId: string): boolean {
    return this.sql.exec("SELECT 1 FROM banned WHERE player_id = ?", playerId).toArray().length > 0;
  }

  bucket(key: string): BucketState | null {
    return (
      this.sql
        .exec<{ tokens: number; at: number; connectTokens: number; connectAt: number }>(
          "SELECT tokens, at, connect_tokens AS connectTokens, connect_at AS connectAt FROM buckets WHERE key = ?",
          key,
        )
        .toArray()[0] ?? null
    );
  }

  saveBucket(key: string, state: BucketState): void {
    this.sql.exec(
      `INSERT INTO buckets (key, tokens, at, connect_tokens, connect_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET tokens = excluded.tokens, at = excluded.at,
         connect_tokens = excluded.connect_tokens, connect_at = excluded.connect_at`,
      key, state.tokens, state.at, state.connectTokens, state.connectAt,
    );
  }

  playerCount(): number {
    return this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM players").one().n;
  }

  players(): { id: string; pseudo: string }[] {
    return this.sql.exec<{ id: string; pseudo: string }>("SELECT id, pseudo FROM players ORDER BY joined_at, id").toArray();
  }

  player(id: string): { id: string; pseudo: string } | null {
    return this.sql.exec<{ id: string; pseudo: string }>("SELECT id, pseudo FROM players WHERE id = ?", id).toArray()[0] ?? null;
  }

  // Idempotent : la première réponse d'un joueur à une question est la seule retenue.
  insertAnswer(answer: { playerId: string; questionId: string; optionIds: string[]; receivedAt: number; elapsedMs: number; correct: boolean; late: boolean }): boolean {
    const cursor = this.sql.exec(
      "INSERT INTO answers (player_id, question_id, option_ids, received_at, elapsed_ms, correct, late) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(player_id, question_id) DO NOTHING",
      answer.playerId, answer.questionId, JSON.stringify(answer.optionIds), answer.receivedAt, answer.elapsedMs, answer.correct ? 1 : 0, answer.late ? 1 : 0,
    );
    return cursor.rowsWritten > 0;
  }

  answerOf(playerId: string, questionId: string): StoredAnswer | null {
    const row = this.sql
      .exec<{ optionIds: string; correct: number; late: number }>(
        "SELECT option_ids AS optionIds, correct, late FROM answers WHERE player_id = ? AND question_id = ?",
        playerId, questionId,
      )
      .toArray()[0];
    return row ? { optionIds: JSON.parse(row.optionIds) as string[], correct: row.correct === 1, late: row.late === 1 } : null;
  }

  // Les réponses tardives sont enregistrées mais ne comptent pas : l'hôte voit qui a répondu dans les temps.
  answeredCount(questionId: string): number {
    return this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM answers WHERE question_id = ? AND late = 0", questionId).one().n;
  }

  correctPlayerIds(questionId: string): Set<string> {
    return new Set(
      this.sql.exec<{ playerId: string }>("SELECT player_id AS playerId FROM answers WHERE question_id = ? AND correct = 1", questionId).toArray().map((r) => r.playerId),
    );
  }

  // `excludingQuestionId` : pendant une question, le score d'un joueur ne doit pas révéler si sa réponse en cours est juste.
  ranking(excludingQuestionId = ""): RankingEntry[] {
    return this.sql
      .exec<RankingEntry>(
        `SELECT p.id AS playerId, p.pseudo AS pseudo, COALESCE(SUM(a.correct), 0) AS score,
                COALESCE(SUM(CASE WHEN a.correct = 1 THEN a.elapsed_ms ELSE 0 END), 0) AS totalMs
         FROM players p LEFT JOIN answers a ON a.player_id = p.id AND a.question_id <> ? GROUP BY p.id`,
        excludingQuestionId,
      )
      .toArray();
  }

  playerState(playerId: string): PlayerState | null {
    return (
      this.sql
        .exec<PlayerState>(
          "SELECT player_id AS playerId, idx, phase, started_at AS startedAt, duration_ms AS durationMs FROM pstate WHERE player_id = ?",
          playerId,
        )
        .toArray()[0] ?? null
    );
  }

  hasPlayerState(playerId: string): boolean {
    return this.sql.exec("SELECT 1 FROM pstate WHERE player_id = ?", playerId).toArray().length > 0;
  }

  // `deadline` : instant limite de la réponse (tolérance comprise), null quand le joueur n'est pas en question.
  savePlayerState(state: PlayerState, deadline: number | null): void {
    this.sql.exec(
      `INSERT INTO pstate (player_id, idx, phase, started_at, duration_ms, deadline) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(player_id) DO UPDATE SET idx = excluded.idx, phase = excluded.phase, started_at = excluded.started_at,
         duration_ms = excluded.duration_ms, deadline = excluded.deadline`,
      state.playerId, state.idx, state.phase, state.startedAt, state.durationMs, deadline,
    );
  }

  // Joueurs inscrits mais sans état d'avancement : ceux qui n'ont pas encore commencé.
  playersWithoutState(): string[] {
    return this.sql
      .exec<{ id: string }>("SELECT p.id AS id FROM players p LEFT JOIN pstate s ON s.player_id = p.id WHERE s.player_id IS NULL")
      .toArray()
      .map((row) => row.id);
  }

  expiredPlayerIds(now: number): string[] {
    return this.sql
      .exec<{ playerId: string }>("SELECT player_id AS playerId FROM pstate WHERE phase = 'question' AND deadline <= ?", now)
      .toArray()
      .map((row) => row.playerId);
  }

  nextPlayerDeadline(): number | null {
    return this.sql.exec<{ at: number | null }>("SELECT MIN(deadline) AS at FROM pstate WHERE phase = 'question'").one().at;
  }

  doneCount(): number {
    return this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM pstate WHERE phase = 'done'").one().n;
  }

  playerScore(playerId: string): number {
    return this.sql.exec<{ n: number }>("SELECT COALESCE(SUM(correct), 0) AS n FROM answers WHERE player_id = ?", playerId).one().n;
  }

  // Agrégats de fin de partie calculés par SQLite : jamais 200 joueurs x 50 questions de lignes remontées en JavaScript.
  // Les réponses tardives sont hors compteur, comme pour l'hôte.
  answerTotals(): { questionId: string; answerCount: number; correctCount: number }[] {
    return this.sql
      .exec<{ questionId: string; answerCount: number; correctCount: number }>(
        `SELECT q.id AS questionId, COUNT(a.player_id) AS answerCount, COALESCE(SUM(a.correct), 0) AS correctCount
         FROM questions q LEFT JOIN answers a ON a.question_id = q.id AND a.late = 0 GROUP BY q.id`,
      )
      .toArray();
  }

  optionPicks(): { questionId: string; optionId: string; n: number }[] {
    return this.sql
      .exec<{ questionId: string; optionId: string; n: number }>(
        `SELECT a.question_id AS questionId, j.value AS optionId, COUNT(*) AS n
         FROM answers a, json_each(a.option_ids) j WHERE a.late = 0 GROUP BY a.question_id, j.value`,
      )
      .toArray();
  }

  allQuestions(): StoredQuestion[] {
    return this.sql
      .exec<StoredQuestion>(
        "SELECT id, position, kind, prompt, duration_ms AS durationMs, reference, explanation FROM questions ORDER BY position",
      )
      .toArray();
  }

  allOptions(): (StoredOption & { questionId: string })[] {
    return this.sql
      .exec<{ id: string; questionId: string; label: string; isCorrect: number }>(
        "SELECT id, question_id AS questionId, label, is_correct AS isCorrect FROM options ORDER BY question_id, position",
      )
      .toArray()
      .map((row) => ({ id: row.id, questionId: row.questionId, label: row.label, isCorrect: row.isCorrect === 1 }));
  }

  purge(): Promise<void> {
    return this.storage.deleteAll();
  }
}
