"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";

import { Button } from "@/components/ui/button";
import { Rubrique } from "@/components/ui/rubrique";
import { ReglureMarge } from "@/components/ui/reglure-marge";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import {
  fetchCurrentQuestion,
  submitAnswer,
  submitEmptyAnswer,
  type GameQuestion,
  type AnswerResult,
} from "@/lib/game";

const LETTERS = ["A", "B", "C", "D", "E", "F"];

type Screen =
  | "question"
  | "correction"
  | "finished"
  | "waiting"
  | "attente_validation"
  | "attente_resultats";

export function GameScreen({
  code,
  sessionId,
  mode = "libre",
  correctionImmediate = true,
  participantId,
  initialQuestion,
}: {
  code: string;
  sessionId?: string;
  mode?: "libre" | "synchronise";
  correctionImmediate?: boolean;
  participantId: string;
  initialQuestion: GameQuestion | null;
}) {
  const router = useRouter();
  const { addToast } = useToast();
  const prefersReducedMotion = useReducedMotion();
  const supabase = useMemo(() => createClient(), []);
  const pilotageManuel = mode === "synchronise";

  const [screen, setScreen] = useState<Screen>(
    initialQuestion ? "question" : "finished"
  );
  const [question, setQuestion] = useState<GameQuestion | null>(initialQuestion);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [connectionState, setConnectionState] = useState<"ok" | "retrying">(
    "ok"
  );
  const [correctCount, setCorrectCount] = useState(0);
  const [totalQuestions, setTotalQuestions] = useState(
    initialQuestion?.total_questions ?? 0
  );

  const pendingAnswerRef = useRef<{
    questionId: string;
    optionIds: string[];
    questionOptions: { id: string; libelle: string }[];
  } | null>(null);
  const pendingResultRef = useRef<{ questionId: string; answer: AnswerResult } | null>(
    null
  );

  const storageKey = useMemo(() => `q-${code}-participant`, [code]);

  useEffect(() => {
    localStorage.setItem(storageKey, participantId);
  }, [storageKey, participantId]);

  const loadNext = useCallback(async () => {
    try {
      const current = await fetchCurrentQuestion(participantId);
      if (!current) {
        router.push(`/q/${code}/resultat?participant_id=${participantId}`);
        return;
      }
      setQuestion(current);
      setTotalQuestions(current.total_questions);
      setSelectedIds([]);
      setResult(null);
      setScreen("question");
    } catch (error) {
      addToast({
        title: "Erreur de chargement",
        description:
          error instanceof Error ? error.message : "Impossible de charger la question.",
        variant: "error",
      });
    }
  }, [participantId, code, router, addToast]);

  async function sendAnswer(
    questionId: string,
    optionIds: string[],
    questionOptions: { id: string; libelle: string }[]
  ) {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setConnectionState("ok");

    try {
      const answer = await submitAnswer(
        participantId,
        questionId,
        optionIds,
        questionOptions
      );
      handleAnswerResponse(questionId, answer);
    } catch {
      pendingAnswerRef.current = { questionId, optionIds, questionOptions };
      setConnectionState("retrying");
      retryAnswer();
    } finally {
      setIsSubmitting(false);
    }
  }

  function retryAnswer() {
    const pending = pendingAnswerRef.current;
    if (!pending) return;

    setConnectionState("retrying");

    const attempt = async () => {
      try {
        const answer = await submitAnswer(
          participantId,
          pending.questionId,
          pending.optionIds,
          pending.questionOptions
        );
        pendingAnswerRef.current = null;
        setConnectionState("ok");
        handleAnswerResponse(pending.questionId, answer);
      } catch {
        setTimeout(attempt, 2000);
      }
    };

    void attempt();
  }

  function handleAnswerResponse(questionId: string, answer: AnswerResult) {
    if (answer.is_finished) {
      if (pilotageManuel) {
        if (answer.is_correct) setCorrectCount((prev) => prev + 1);
        setScreen("attente_resultats");
        return;
      }
      router.push(`/q/${code}/resultat?participant_id=${participantId}`);
      return;
    }

    if (pilotageManuel && !correctionImmediate) {
      pendingResultRef.current = { questionId, answer };
      setScreen("attente_validation");
      return;
    }

    setResult(answer);
    if (answer.is_correct) setCorrectCount((prev) => prev + 1);
    setScreen("correction");
  }

  useEffect(() => {
    if (!pilotageManuel || !sessionId) return;

    const channel = supabase
      .channel(`participant-session:${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "sessions",
          filter: `id=eq.${sessionId}`,
        },
        (payload) => {
          const next = payload.new as {
            question_courante_id: string | null;
            reponses_reveles_le: string | null;
            resultats_reveles: boolean;
          };

          if (next.resultats_reveles) {
            router.push(`/q/${code}/resultat?participant_id=${participantId}`);
            return;
          }

          const pending = pendingResultRef.current;
          if (pending && next.reponses_reveles_le && question?.id === pending.questionId) {
            setResult(pending.answer);
            if (pending.answer.is_correct) setCorrectCount((prev) => prev + 1);
            pendingResultRef.current = null;
            setScreen("correction");
            return;
          }

          if (next.question_courante_id && next.question_courante_id !== question?.id) {
            void loadNext();
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [pilotageManuel, sessionId, supabase, question?.id, code, participantId, router, loadNext]);

  function handleSelect(optionId: string) {
    if (!question || screen !== "question") return;

    if (question.type === "multiple") {
      setSelectedIds((prev) =>
        prev.includes(optionId)
          ? prev.filter((id) => id !== optionId)
          : [...prev, optionId]
      );
      return;
    }

    void sendAnswer(question.id, [optionId], question.options);
  }

  function handleValidateMultiple() {
    if (!question || screen !== "question" || question.type !== "multiple")
      return;
    void sendAnswer(question.id, selectedIds, question.options);
  }

  async function handleExpire() {
    if (!question || screen !== "question") return;
    try {
      const answer = await submitEmptyAnswer(participantId, question.id, question.options);
      handleAnswerResponse(question.id, answer);
    } catch {
      const answer = await submitEmptyAnswer(participantId, question.id, question.options);
      handleAnswerResponse(question.id, answer);
    }
  }

  function handleContinue() {
    void loadNext();
  }

  if (screen === "attente_validation") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-encre p-4 text-center text-craie">
        <p className="font-display text-2xl">Réponse envoyée</p>
        <p className="text-sm text-adire">
          L&apos;animateur valide les réponses de tout le monde avant de révéler la correction.
        </p>
      </main>
    );
  }

  if (screen === "attente_resultats") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-encre p-4 text-center text-craie">
        <p className="font-display text-2xl">Dernière question envoyée</p>
        <p className="text-sm text-adire">
          L&apos;animateur va bientôt afficher les résultats finaux.
        </p>
      </main>
    );
  }

  if (screen === "waiting" || !question) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-encre p-4 text-craie">
        <p className="animate-pulse">Préparation de la question…</p>
      </main>
    );
  }

  if (screen === "finished") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-encre p-4 text-center text-craie">
        <h1 className="font-display text-3xl">Partie terminée !</h1>
        <p className="text-lg">
          <span className="text-or">{correctCount}</span> / {totalQuestions} bonnes réponses
        </p>
        <p className="text-sm text-adire">Tu peux fermer cette page.</p>
      </main>
    );
  }

  const variants = {
    enter: { opacity: 0, x: prefersReducedMotion ? 0 : 24 },
    center: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: prefersReducedMotion ? 0 : -24 },
  };

  return (
    <main className="min-h-screen bg-encre p-4 text-craie sm:p-6">
      {connectionState === "retrying" && (
        <div className="fixed right-4 top-4 z-50 flex items-center gap-2 rounded-full bg-adire/20 px-3 py-1 text-xs text-craie">
          <span className="size-2 rounded-full bg-or" />
          Connexion…
        </div>
      )}

      <AnimatePresence mode="wait">
        {screen === "question" && (
          <motion.div
            key={question.id}
            initial="enter"
            animate="center"
            exit="exit"
            variants={variants}
            transition={{ duration: prefersReducedMotion ? 0 : 0.2 }}
            className="mx-auto max-w-2xl"
          >
            <header className="mb-6">
              <Rubrique>
                Question {question.ordre} sur {question.total_questions}
              </Rubrique>
            </header>

            <div className="mb-8">
              <ReglureMarge
                durationMs={question.duree_sec * 1000}
                startedAt={question.started_at}
                serverNow={question.server_now}
                onExpire={handleExpire}
                className="bg-encre text-craie"
              >
                <p className="font-display text-2xl leading-relaxed text-craie sm:text-3xl md:text-4xl">
                  {question.enonce}
                </p>
              </ReglureMarge>
            </div>

            {question.type === "multiple" && (
              <p className="mb-4 text-sm text-adire">
                Sélectionne une ou plusieurs réponses.
              </p>
            )}

            <div className="space-y-3">
              {question.options.map((option, index) => {
                const selected = selectedIds.includes(option.id);
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => handleSelect(option.id)}
                    disabled={isSubmitting}
                    className={`flex w-full min-h-14 items-center gap-4 rounded-sm border px-4 text-left transition-colors ${
                      selected
                        ? "border-indigo bg-indigo/10"
                        : "border-adire/40 bg-encre hover:bg-adire/10"
                    }`}
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-adire/40 font-mono text-sm text-craie">
                      {LETTERS[index]}
                    </span>
                    <span className="text-base text-craie">{option.libelle}</span>
                  </button>
                );
              })}
            </div>

            {question.type === "multiple" && (
              <Button
                variant="primary"
                size="lg"
                className="mt-6 w-full"
                onClick={handleValidateMultiple}
                loading={isSubmitting}
                disabled={selectedIds.length === 0}
              >
                Valider la sélection
              </Button>
            )}
          </motion.div>
        )}

        {screen === "correction" && result && (
          <motion.div
            key={`correction-${question.id}`}
            initial="enter"
            animate="center"
            exit="exit"
            variants={variants}
            transition={{ duration: prefersReducedMotion ? 0 : 0.2 }}
            className="mx-auto max-w-2xl space-y-6"
          >
            <div className="text-center">
              <p
                className={`font-display text-3xl ${
                  result.is_correct ? "text-or" : "text-rubrique"
                }`}
              >
                {result.is_correct ? "Juste !" : "Faux"}
              </p>
            </div>

            <div className="space-y-2 rounded-sm border border-adire/40 p-4">
              <p className="text-sm text-adire">Bonnes réponses</p>
              <ul className="space-y-1">
                {result.bonnes_reponses.map((r, index) => (
                  <li key={index} className="text-craie">
                    {r}
                  </li>
                ))}
              </ul>
            </div>

            {result.explication && (
              <div className="space-y-2 rounded-sm border border-adire/40 p-4">
                <p className="text-sm text-adire">Explication</p>
                <p className="text-craie">{result.explication}</p>
              </div>
            )}

            {result.reference_biblique && (
              <p className="text-center font-mono text-sm uppercase tracking-widest text-adire">
                {result.reference_biblique}
              </p>
            )}

            {pilotageManuel ? (
              <p className="text-center text-sm text-adire">
                En attente de la question suivante…
              </p>
            ) : (
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                onClick={handleContinue}
              >
                Continuer
              </Button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
