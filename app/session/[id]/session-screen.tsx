"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { Copy, LogOut, Users, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Rubrique } from "@/components/ui/rubrique";
import { RuleFrame } from "@/components/ui/rule-frame";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { classement as fetchClassement } from "@/lib/quiz";
import type { ClassementRow } from "@/types/database";
import {
  fermerSession,
  pousserQuestion,
  terminerSession,
  validerQuestion,
} from "@/app/session/[id]/session-actions";

type Participant = {
  id: string;
  pseudo: string;
  score_total: number;
  cree_le: string;
};

type QuestionOption = {
  id: string;
  libelle: string;
  est_correcte: boolean;
};

type SessionQuestion = {
  id: string;
  enonce: string;
  type: string;
  explication: string | null;
  reference_biblique: string | null;
  options: QuestionOption[];
};

export function SessionScreen({
  sessionId,
  code,
  quizTitle,
  mode,
  correctionImmediate,
  questions,
  currentQuestionId,
  initialReponsesRevelesLe = null,
  initialResultatsReveles = false,
  initialParticipants = [],
  initialAnswersCount = 0,
}: {
  sessionId: string;
  code: string;
  quizTitle: string;
  mode: "libre" | "synchronise";
  correctionImmediate: boolean;
  questions: SessionQuestion[];
  currentQuestionId: string | null;
  initialReponsesRevelesLe?: string | null;
  initialResultatsReveles?: boolean;
  initialParticipants?: Participant[];
  initialAnswersCount?: number;
}) {
  const router = useRouter();
  const { addToast } = useToast();
  const supabase = useMemo(() => createClient(), []);

  const [participants, setParticipants] = useState<Participant[]>(initialParticipants);
  const [answersCount, setAnswersCount] = useState(initialAnswersCount);
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(
    currentQuestionId
  );
  const [reponsesRevelesLe, setReponsesRevelesLe] = useState<string | null>(
    initialReponsesRevelesLe
  );
  const [resultatsReveles, setResultatsReveles] = useState(
    initialResultatsReveles
  );
  const [classement, setClassement] = useState<ClassementRow[] | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const [isSharing, setIsSharing] = useState(false);

  const joinUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/rejoindre?code=${code}`;
  }, [code]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(joinUrl);
      addToast({ title: "Lien copié", variant: "success" });
    } catch {
      addToast({ title: "Impossible de copier", variant: "error" });
    }
  }

  const loadParticipants = useCallback(async () => {
    const { data, error } = await supabase
      .from("participants")
      .select("id, pseudo, score_total, cree_le")
      .eq("session_id", sessionId)
      .order("score_total", { ascending: false });

    if (error) {
      console.error(error);
      return;
    }

    setParticipants(
      (data ?? []).map((p) => ({
        id: p.id as string,
        pseudo: p.pseudo as string,
        score_total: p.score_total as number,
        cree_le: p.cree_le as string,
      }))
    );
  }, [sessionId, supabase]);

  const countAnswers = useCallback(async () => {
    if (!activeQuestionId) {
      setAnswersCount(0);
      return;
    }
    const { count, error } = await supabase
      .from("reponses")
      .select("id", { count: "exact", head: true })
      .eq("question_id", activeQuestionId);

    if (error) {
      console.error(error);
      return;
    }

    setAnswersCount(count ?? 0);
  }, [activeQuestionId, supabase]);

  useEffect(() => {
    const participantsChannel = supabase
      .channel(`participants:${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "participants",
          filter: `session_id=eq.${sessionId}`,
        },
        () => loadParticipants()
      )
      .subscribe();

    const responsesChannel = supabase
      .channel(`responses:${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "reponses",
          filter: `question_id=eq.${activeQuestionId ?? ""}`,
        },
        () => countAnswers()
      )
      .subscribe();

    const sessionChannel = supabase
      .channel(`session:${sessionId}`)
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
          setActiveQuestionId(next.question_courante_id);
          setReponsesRevelesLe(next.reponses_reveles_le);
          setResultatsReveles(next.resultats_reveles);
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(participantsChannel);
      void supabase.removeChannel(responsesChannel);
      void supabase.removeChannel(sessionChannel);
    };
  }, [sessionId, supabase, loadParticipants, countAnswers, activeQuestionId]);

  const questionIds = useMemo(() => questions.map((q) => q.id), [questions]);
  const activeQuestion = useMemo(
    () => questions.find((q) => q.id === activeQuestionId) ?? null,
    [questions, activeQuestionId]
  );

  useEffect(() => {
    if (!resultatsReveles) return;
    fetchClassement(sessionId)
      .then(setClassement)
      .catch((error) => console.error(error));
  }, [resultatsReveles, sessionId]);

  const currentQuestionIndex = activeQuestionId
    ? questionIds.indexOf(activeQuestionId) + 1
    : 0;
  const isLastQuestion =
    currentQuestionIndex > 0 && currentQuestionIndex === questionIds.length;
  const isRevealed = Boolean(reponsesRevelesLe);

  async function handleNextQuestion() {
    const nextIndex = activeQuestionId
      ? questionIds.indexOf(activeQuestionId) + 1
      : 0;

    if (nextIndex >= questionIds.length) {
      addToast({
        title: "Fin du quiz",
        description: "Toutes les questions ont été diffusées.",
        variant: "info",
      });
      return;
    }

    setIsPushing(true);
    try {
      await pousserQuestion(sessionId, questionIds[nextIndex]);
      setActiveQuestionId(questionIds[nextIndex]);
      setAnswersCount(0);
      setReponsesRevelesLe(null);
    } catch (error) {
      addToast({
        title: "Erreur",
        description: error instanceof Error ? error.message : "Réessayez.",
        variant: "error",
      });
    } finally {
      setIsPushing(false);
    }
  }

  async function handleValidate() {
    setIsValidating(true);
    try {
      await validerQuestion(sessionId);
      setReponsesRevelesLe(new Date().toISOString());
    } catch (error) {
      addToast({
        title: "Erreur",
        description: error instanceof Error ? error.message : "Réessayez.",
        variant: "error",
      });
    } finally {
      setIsValidating(false);
    }
  }

  async function handleFinish() {
    setIsFinishing(true);
    try {
      await terminerSession(sessionId);
      setResultatsReveles(true);
    } catch (error) {
      addToast({
        title: "Erreur",
        description: error instanceof Error ? error.message : "Réessayez.",
        variant: "error",
      });
    } finally {
      setIsFinishing(false);
    }
  }

  async function handleShareClassement() {
    if (isSharing) return;
    setIsSharing(true);

    try {
      const imageUrl = `/api/share-classement?session_id=${encodeURIComponent(
        sessionId
      )}`;
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const file = new File([blob], "quizdeszeles-classement.png", {
        type: blob.type,
      });
      const shareUrl = `${window.location.origin}/rejoindre?code=${code}`;

      const shareApi = navigator as Navigator & {
        canShare?: (data?: ShareData) => boolean;
        share?: (data?: ShareData) => Promise<void>;
      };

      if (shareApi.canShare?.({ files: [file] })) {
        await shareApi.share({
          title: `Classement final — ${quizTitle}`,
          text: `Découvre le classement final de ${quizTitle} !`,
          files: [file],
        });
      } else if (shareApi.share) {
        await shareApi.share({
          title: `Classement final — ${quizTitle}`,
          text: `Découvre le classement final de ${quizTitle} !`,
          url: shareUrl,
        });
      } else {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "quizdeszeles-classement.png";
        link.click();
        URL.revokeObjectURL(link.href);
      }
    } catch (error) {
      addToast({
        title: "Partage impossible",
        description: error instanceof Error ? error.message : "Réessaie.",
        variant: "error",
      });
    } finally {
      setIsSharing(false);
    }
  }

  async function handleClose() {
    if (!window.confirm("Clôturer la session pour tous les participants ?")) {
      return;
    }
    setIsClosing(true);
    try {
      await fermerSession(sessionId);
      router.push("/tableau-de-bord");
    } catch (error) {
      setIsClosing(false);
      addToast({
        title: "Erreur",
        description: error instanceof Error ? error.message : "Réessayez.",
        variant: "error",
      });
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-encre text-craie">
      <header className="flex items-center justify-between border-b border-adire/30 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <Link
            href="/tableau-de-bord"
            className="inline-flex size-10 items-center justify-center rounded-sm text-craie transition-colors hover:bg-adire/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <LogOut className="size-4" aria-hidden="true" />
            <span className="sr-only">Quitter</span>
          </Link>
          <div>
            <Rubrique>Session active</Rubrique>
            <h1 className="font-display text-xl text-craie sm:text-2xl">
              {quizTitle}
            </h1>
          </div>
        </div>
        <Button
          variant="ghost"
          size="md"
          aria-label="Clôturer la session"
          className="text-rubrique hover:bg-rubrique/10 hover:text-rubrique focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          loading={isClosing}
          onClick={handleClose}
        >
          <X className="size-5" aria-hidden="true" />
          <span className="sr-only">Clôturer</span>
        </Button>
      </header>

      <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 p-4 sm:p-6">
        {resultatsReveles ? (
          <RuleFrame
            className="w-full max-w-2xl border border-adire/40 bg-encre p-6 sm:p-10"
            position="top"
          >
            <div className="space-y-6 text-center">
              <p className="text-sm uppercase tracking-widest text-adire">
                Résultats finaux
              </p>
              <h2 className="font-display text-2xl text-craie">
                Classement — du premier au dernier
              </h2>
              {classement === null ? (
                <p className="text-adire">Chargement du classement…</p>
              ) : classement.length === 0 ? (
                <p className="text-adire">Aucun participant n&apos;a joué.</p>
              ) : (
                <ol className="space-y-2 text-left">
                  {classement.map((row) => (
                    <li
                      key={`${row.rang}-${row.pseudo}`}
                      className="flex items-center justify-between rounded-sm border border-adire/40 px-4 py-3"
                    >
                      <span className="flex items-center gap-3">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-adire/40 font-mono text-sm text-craie">
                          {row.rang}
                        </span>
                        <span className="text-base text-craie">{row.pseudo}</span>
                      </span>
                      <span className="font-mono text-or">
                        {row.score_total} / {questions.length} bonnes réponses
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                loading={isSharing}
                onClick={handleShareClassement}
              >
                Partager le classement
              </Button>
            </div>
          </RuleFrame>
        ) : !activeQuestionId ? (
          <RuleFrame
            className="w-full max-w-3xl border border-adire/40 bg-encre p-6 sm:p-10"
            position="top"
          >
            <div className="space-y-8 text-center">
              <div>
                <p className="mb-2 text-sm uppercase tracking-widest text-adire">
                  Code à partager
                </p>
                <p className="break-words font-mono text-5xl font-medium tracking-wide text-craie sm:text-7xl md:text-8xl lg:text-9xl">
                  {code}
                </p>
              </div>

              <div className="flex flex-col items-center gap-4">
                {joinUrl && (
                  <RuleFrame
                    className="rounded-sm bg-craie p-3"
                    position="left"
                    ruleClassName="bg-indigo"
                  >
                    <QRCodeSVG value={joinUrl} size={144} level="M" bgColor="#f3f0e7" fgColor="#2b3f8c" />
                  </RuleFrame>
                )}
                <div className="flex w-full max-w-md items-center gap-2">
                  <p className="break-all text-sm text-adire">{joinUrl}</p>
                  <Button
                    variant="ghost"
                    size="md"
                    aria-label="Copier le lien"
                    className="shrink-0 text-craie hover:bg-adire/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={copyLink}
                  >
                    <Copy className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </div>
          </RuleFrame>
        ) : null}

        {mode === "synchronise" && activeQuestion && !resultatsReveles && (
          <RuleFrame
            className="w-full max-w-3xl border border-adire/40 bg-encre p-6 sm:p-8"
            position="left"
          >
            <div className="space-y-4 text-left">
              <p className="text-sm uppercase tracking-widest text-adire">
                Question {currentQuestionIndex} / {questionIds.length}
              </p>
              <p className="font-display text-xl text-craie sm:text-2xl">
                {activeQuestion.enonce}
              </p>
              <ul className="space-y-2">
                {activeQuestion.options.map((option) => (
                  <li
                    key={option.id}
                    className={`rounded-sm border px-4 py-2 text-sm ${
                      isRevealed && option.est_correcte
                        ? "border-or bg-or/10 text-craie"
                        : "border-adire/40 text-craie"
                    }`}
                  >
                    {option.libelle}
                    {isRevealed && option.est_correcte && (
                      <span className="ml-2 text-or">— bonne réponse</span>
                    )}
                  </li>
                ))}
              </ul>
              {isRevealed && activeQuestion.explication && (
                <div className="space-y-1 rounded-sm border border-adire/40 bg-adire/10 p-4">
                  <p className="text-sm font-medium text-or">Explication</p>
                  <p className="text-sm text-craie">{activeQuestion.explication}</p>
                  {activeQuestion.reference_biblique && (
                    <p className="text-xs text-adire">
                      Réf. : {activeQuestion.reference_biblique}
                    </p>
                  )}
                </div>
              )}
              <p className="text-sm text-adire">
                Réponses reçues : {answersCount} / {participants.length}
              </p>
              {!correctionImmediate && (
                <p className="text-sm text-adire">
                  {isRevealed
                    ? "Correction révélée aux participants."
                    : "Les participants voient leur résultat une fois que tu révèles la réponse."}
                </p>
              )}
            </div>
          </RuleFrame>
        )}
      </main>

      <footer className="border-t border-adire/30 px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          {mode === "synchronise" && !resultatsReveles && (
            <div className="flex flex-wrap items-center gap-3">
              {!activeQuestionId ? (
                <Button
                  variant="primary"
                  size="lg"
                  loading={isPushing}
                  onClick={handleNextQuestion}
                >
                  Lancer la première question
                </Button>
              ) : !isRevealed ? (
                <Button
                  variant="primary"
                  size="lg"
                  loading={isValidating}
                  onClick={handleValidate}
                >
                  Révéler la réponse
                </Button>
              ) : isLastQuestion ? (
                <Button
                  variant="primary"
                  size="lg"
                  loading={isFinishing}
                  onClick={handleFinish}
                >
                  Terminer et afficher les résultats
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="lg"
                  loading={isPushing}
                  onClick={handleNextQuestion}
                >
                  Question suivante
                </Button>
              )}
            </div>
          )}

          <details className="group sm:ml-auto">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm text-craie transition-colors hover:text-or focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Users className="size-4" aria-hidden="true" />
              Participants ({participants.length})
            </summary>
            <div className="mt-2 max-h-48 overflow-y-auto rounded-sm border border-adire/40 bg-encre p-2">
              {participants.length === 0 ? (
                <p className="text-sm text-adire">
                  Aucun participant pour l&apos;instant.
                </p>
              ) : (
                <ul className="space-y-1">
                  {participants.map((p) => (
                    <li
                      key={p.id}
                      className="flex justify-between text-sm text-craie"
                    >
                      <span>{p.pseudo}</span>
                      <span className="text-adire">{p.score_total} bonnes réponses</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>
        </div>
      </footer>
    </div>
  );
}
