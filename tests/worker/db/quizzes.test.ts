/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../../../src/server/db/client";
import {
  addQuestion,
  createQuiz,
  deleteQuestion,
  deleteQuiz,
  duplicateQuiz,
  getQuizForEditor,
  listQuizzes,
  loadQuizSnapshot,
  NotFoundError,
  reorderQuestions,
  updateQuestion,
  updateQuizSettings,
} from "../../../src/server/db/quizzes";
import { freshDb, insertUser, sampleQuestion } from "./helpers";

let db: Db;
beforeEach(async () => {
  db = await freshDb();
  await insertUser(db, "alice");
  await insertUser(db, "bob");
});

describe("quiz : isolation par propriétaire", () => {
  it("un autre compte ne voit, ne modifie et ne supprime rien", async () => {
    const quizId = await createQuiz(db, "alice", { title: "Privé" });
    const questionId = await addQuestion(db, "alice", quizId, sampleQuestion());

    expect(await listQuizzes(db, "bob")).toEqual([]);
    expect(await getQuizForEditor(db, "bob", quizId)).toBeNull();
    await expect(updateQuizSettings(db, "bob", quizId, { title: "Piraté" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteQuiz(db, "bob", quizId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(addQuestion(db, "bob", quizId, sampleQuestion())).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateQuestion(db, "bob", questionId, sampleQuestion())).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteQuestion(db, "bob", questionId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(reorderQuestions(db, "bob", quizId, [questionId])).rejects.toBeInstanceOf(NotFoundError);
    await expect(duplicateQuiz(db, "bob", quizId, "Copie")).rejects.toBeInstanceOf(NotFoundError);

    const intact = await getQuizForEditor(db, "alice", quizId);
    expect(intact?.title).toBe("Privé");
    expect(intact?.questions).toHaveLength(1);
  });
});

describe("quiz : CRUD", () => {
  it("ajoute, met à jour, réordonne et supprime des questions", async () => {
    const quizId = await createQuiz(db, "alice", { title: "Mon quiz" });
    const q1 = await addQuestion(db, "alice", quizId, sampleQuestion({ prompt: "Un" }));
    const q2 = await addQuestion(db, "alice", quizId, sampleQuestion({ prompt: "Deux" }));
    const q3 = await addQuestion(db, "alice", quizId, sampleQuestion({ prompt: "Trois" }));

    await reorderQuestions(db, "alice", quizId, [q3, q1, q2]);
    expect((await getQuizForEditor(db, "alice", quizId))?.questions.map((q) => q.prompt)).toEqual(["Trois", "Un", "Deux"]);
    await expect(reorderQuestions(db, "alice", quizId, [q1, q2])).rejects.toThrow("Ordre des questions invalide");

    await updateQuestion(
      db,
      "alice",
      q1,
      sampleQuestion({
        type: "multiple",
        prompt: "Un bis",
        durationSec: 60,
        options: [
          { label: "A", isCorrect: true },
          { label: "B", isCorrect: true },
          { label: "C", isCorrect: false },
        ],
      }),
    );
    const edited = (await getQuizForEditor(db, "alice", quizId))?.questions.find((q) => q.id === q1);
    expect(edited).toMatchObject({ type: "multiple", prompt: "Un bis", durationSec: 60 });
    expect(edited?.options.map((o) => o.label)).toEqual(["A", "B", "C"]);

    await deleteQuestion(db, "alice", q2);
    expect((await getQuizForEditor(db, "alice", quizId))?.questions).toHaveLength(2);

    await updateQuizSettings(db, "alice", quizId, { mode: "own_pace", shuffle: true, showCorrectAnswer: false });
    expect(await getQuizForEditor(db, "alice", quizId)).toMatchObject({ mode: "own_pace", shuffle: true, showCorrectAnswer: false });

    await deleteQuiz(db, "alice", quizId);
    expect(await getQuizForEditor(db, "alice", quizId)).toBeNull();
    const orphans = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM questions) AS q, (SELECT COUNT(*) FROM options) AS o").first();
    expect(orphans).toEqual({ q: 0, o: 0 });
  });

  it("duplique un quiz avec ses questions et options", async () => {
    const quizId = await createQuiz(db, "alice", { title: "Original", questions: [sampleQuestion(), sampleQuestion({ prompt: "Autre" })] });
    const copyId = await duplicateQuiz(db, "alice", quizId, "Copie");
    const copy = await getQuizForEditor(db, "alice", copyId);
    expect(copy?.title).toBe("Copie");
    expect(copy?.questions.map((q) => q.prompt)).toEqual(["Combien de jours ?", "Autre"]);
    expect(copy?.questions[0]?.options.filter((o) => o.isCorrect)).toHaveLength(1);
    expect(copy?.questions[0]?.id).not.toBe((await getQuizForEditor(db, "alice", quizId))?.questions[0]?.id);
  });

  it("liste les quiz avec nombre de questions et questions incomplètes", async () => {
    const quizId = await createQuiz(db, "alice", { title: "Liste" });
    await addQuestion(db, "alice", quizId, sampleQuestion());
    await addQuestion(db, "alice", quizId, sampleQuestion({ prompt: "  ", options: [{ label: "x", isCorrect: false }] }));
    const [row] = await listQuizzes(db, "alice");
    expect(row).toMatchObject({ id: quizId, questionCount: 2, incompleteCount: 1 });
  });
});

describe("loadQuizSnapshot", () => {
  it("renvoie l'instantané complet avec correction, dans l'ordre", async () => {
    const quizId = await createQuiz(db, "alice", {
      title: "Snap",
      shuffle: true,
      questions: [sampleQuestion({ reference: "Genèse 1", explanation: "Parce que" }), sampleQuestion({ type: "true_false", prompt: "Vrai ?" })],
    });
    const snapshot = await loadQuizSnapshot(db, quizId);
    expect(snapshot).toMatchObject({ quizId, ownerId: "alice", title: "Snap", shuffle: true, mode: "together" });
    expect(snapshot?.questions).toHaveLength(2);
    expect(snapshot?.questions[0]).toMatchObject({ reference: "Genèse 1", explanation: "Parce que", type: "single" });
    expect(snapshot?.questions[0]?.options.map((o) => [o.label, o.isCorrect])).toEqual([
      ["Trois", false],
      ["Six", true],
    ]);
  });

  it("renvoie null pour un quiz inconnu et gère un quiz sans question", async () => {
    expect(await loadQuizSnapshot(db, "inconnu")).toBeNull();
    const quizId = await createQuiz(db, "alice", { title: "Vide" });
    expect((await loadQuizSnapshot(db, quizId))?.questions).toEqual([]);
  });
});
