"use client";

import { useEffect, useState } from "react";
import { ReglureMarge } from "@/components/ui/reglure-marge";

const QUESTIONS = [
  {
    id: "demo-1",
    enonce: "Qui est le premier disciple appelé par Jésus selon Jean ?",
    options: [
      { id: "a", libelle: "Pierre", correct: false },
      { id: "b", libelle: "André", correct: true },
      { id: "c", libelle: "Jean", correct: false },
      { id: "d", libelle: "Jacques", correct: false },
    ],
    explication: "André, frère de Simon Pierre, fut le premier appelé.",
    reference: "Jean 1,40-42",
  },
  {
    id: "demo-2",
    enonce: "Combien de jours Jésus a-t-il passé dans le désert ?",
    options: [
      { id: "a", libelle: "7", correct: false },
      { id: "b", libelle: "30", correct: false },
      { id: "c", libelle: "40", correct: true },
      { id: "d", libelle: "50", correct: false },
    ],
    explication: "L’Esprit le conduit au désert pendant quarante jours.",
    reference: "Marc 1,13",
  },
  {
    id: "demo-3",
    enonce: "Quel est le premier commandement avec promesse ?",
    options: [
      { id: "a", libelle: "Aime ton prochain", correct: false },
      { id: "b", libelle: "Honore ton père et ta mère", correct: true },
      { id: "c", libelle: "Ne tue pas", correct: false },
      { id: "d", libelle: "Ne vole pas", correct: false },
    ],
    explication: "Paul rappelle que c’est la première règle accompagnée d’une promesse.",
    reference: "Éphésiens 6,2",
  },
];

const DURATION_MS = 6000;
const SELECT_DELAY_MS = 2500;
const RESULT_DELAY_MS = 2000;

type DemoQuestion = (typeof QUESTIONS)[number];

function DemoQuestionCard({
  question,
  index,
  total,
  onFinished,
}: {
  question: DemoQuestion;
  index: number;
  total: number;
  onFinished: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [timestamps] = useState(() => ({
    startedAt: new Date().toISOString(),
    serverNow: new Date().toISOString(),
  }));

  useEffect(() => {
    const selectId = setTimeout(() => {
      const correct = question.options.find((o) => o.correct)?.id ?? null;
      setSelectedId(correct);
    }, SELECT_DELAY_MS);

    const resultId = setTimeout(() => {
      setShowResult(true);
    }, DURATION_MS);

    const nextId = setTimeout(() => {
      onFinished();
    }, DURATION_MS + RESULT_DELAY_MS);

    return () => {
      clearTimeout(selectId);
      clearTimeout(resultId);
      clearTimeout(nextId);
    };
  }, [question, onFinished]);

  return (
    <div className="mx-auto w-full max-w-md overflow-hidden rounded-sm border border-adire bg-card">
      <div className="p-4">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          Démo — Question {index + 1} sur {total}
        </p>
      </div>

      <div className="px-4">
        <ReglureMarge
          durationMs={DURATION_MS}
          startedAt={timestamps.startedAt}
          serverNow={timestamps.serverNow}
          className="bg-card"
        >
          <p className="font-display text-lg text-card-foreground">
            {question.enonce}
          </p>
        </ReglureMarge>
      </div>

      <div className="space-y-2 p-4">
        {question.options.map((option) => {
          const selected = selectedId === option.id;
          const correct = showResult && option.correct;
          const wrong = showResult && selected && !option.correct;
          return (
            <button
              key={option.id}
              type="button"
              disabled
              className={`flex w-full items-center gap-3 rounded-sm border px-4 py-3 text-left transition-colors ${
                correct
                  ? "border-indigo bg-indigo/10"
                  : wrong
                    ? "border-rubrique bg-rubrique/10"
                    : selected
                      ? "border-indigo bg-indigo/10"
                      : "border-adire/40 bg-card"
              }`}
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-adire/40 font-mono text-xs text-card-foreground">
                {option.id.toUpperCase()}
              </span>
              <span className="text-sm text-card-foreground">
                {option.libelle}
              </span>
            </button>
          );
        })}
      </div>

      {showResult && (
        <div className="border-t border-adire/40 p-4">
          <p className="font-display text-lg text-or">Juste !</p>
          <p className="mt-1 text-sm text-card-foreground">
            {question.explication}
          </p>
          <p className="mt-2 font-mono text-xs uppercase tracking-widest text-muted-foreground">
            {question.reference}
          </p>
        </div>
      )}
    </div>
  );
}

export function LiveDemo() {
  const [index, setIndex] = useState(0);

  return (
    <DemoQuestionCard
      key={index}
      question={QUESTIONS[index]}
      index={index}
      total={QUESTIONS.length}
      onFinished={() => setIndex((prev) => (prev + 1) % QUESTIONS.length)}
    />
  );
}
