/// <reference types="@cloudflare/vitest-plugin/types" />
import { describe, expect, it } from "vitest";
import { MODELES } from "../../../src/contenu/modeles";
import { isQuestionComplete, questionSchema, quizActionInputs } from "../../../src/shared/quiz-schema";

describe("modèles : exigences de contenu par modèle", () => {
  it.each(MODELES.map((m) => [m.id, m] as const))("%s : vrai/faux faux d'au moins 2, bonnes réponses variées, tout complet", (_id, m) => {
    const tf = m.questions.filter((q) => q.type === "true_false");
    expect(tf.filter((q) => q.options.find((o) => o.label === "Faux")!.isCorrect).length).toBeGreaterThanOrEqual(2);
    expect(tf.filter((q) => q.options.find((o) => o.label === "Vrai")!.isCorrect).length).toBeGreaterThanOrEqual(1);
    const ranks = new Set(m.questions.filter((q) => q.type === "single").map((q) => q.options.findIndex((o) => o.isCorrect)));
    expect(ranks.size).toBeGreaterThanOrEqual(2);
    expect(m.questions.every(isQuestionComplete)).toBe(true);
    expect(m.questions.every((q) => questionSchema.safeParse(q).success)).toBe(true);
    for (const q of m.questions) {
      const correct = q.options.filter((o) => o.isCorrect).length;
      if (q.type !== "multiple") expect(correct).toBe(1);
      else expect(correct).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("règles de brouillon aux frontières", () => {
  const o = (...f: boolean[]) => f.map((isCorrect, i) => ({ label: `R${i}`, isCorrect }));
  const parse = (type: string, options: unknown) => questionSchema.safeParse({ type, prompt: "", durationSec: 10, options });
  it("0 bonne : single, multiple, true_false acceptés ; 2 bonnes : single et true_false refusés, multiple accepté", () => {
    for (const t of ["single", "multiple", "true_false"]) expect(parse(t, o(false, false)).success).toBe(true);
    expect(parse("single", o(true, true)).success).toBe(false);
    expect(parse("true_false", o(true, true)).success).toBe(false);
    expect(parse("multiple", o(true, true, true, true)).success).toBe(true);
  });
  it("majQuestion sans question et entrée non objet : messages français sans mot anglais", () => {
    for (const input of [{ questionId: "x" }, undefined, null, 3, "x"]) {
      const r = quizActionInputs.majQuestion.safeParse(input);
      expect(r.success).toBe(false);
      for (const i of r.error!.issues) expect(i.message).not.toMatch(/Invalid|Required|expected|received/);
    }
  });
});
