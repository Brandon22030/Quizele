"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Copy, Pencil, Play, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Rubrique } from "@/components/ui/rubrique";
import { RuleFrame } from "@/components/ui/rule-frame";
import { useToast } from "@/components/ui/toast";
import {
  deleteQuiz,
  duplicateQuiz,
  launchQuiz,
} from "@/app/tableau-de-bord/actions";

export type QuizSummary = {
  id: string;
  titre: string;
  categorie: string | null;
  statut: "brouillon" | "publie" | "archive";
  maj_le: string;
  questions_count: number;
  sessions_count: number;
};

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

export function QuizCard({ quiz }: { quiz: QuizSummary }) {
  const router = useRouter();
  const { addToast } = useToast();
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);

  async function handleDelete() {
    if (!window.confirm("Supprimer ce quiz ? Cette action est irréversible.")) {
      return;
    }

    setIsDeleting(true);
    try {
      await deleteQuiz(quiz.id);
      addToast({
        title: "Quiz supprimé",
        variant: "success",
      });
    } catch (error) {
      addToast({
        title: "Erreur lors de la suppression",
        description: error instanceof Error ? error.message : "Réessayez.",
        variant: "error",
      });
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleDuplicate() {
    setIsDuplicating(true);
    try {
      await duplicateQuiz(quiz.id);
      addToast({
        title: "Quiz dupliqué",
        variant: "success",
      });
    } catch (error) {
      addToast({
        title: "Erreur lors de la duplication",
        description: error instanceof Error ? error.message : "Réessayez.",
        variant: "error",
      });
    } finally {
      setIsDuplicating(false);
    }
  }

  async function handleLaunch() {
    setIsLaunching(true);
    try {
      const session = await launchQuiz(quiz.id);
      router.push(`/session/${session.session_id}?code=${session.code_court}`);
    } catch (error) {
      addToast({
        title: "Erreur lors du lancement",
        description: error instanceof Error ? error.message : "Réessayez.",
        variant: "error",
      });
      setIsLaunching(false);
    }
  }

  return (
    <RuleFrame
      className="flex flex-col justify-between gap-4 rounded-md border border-adire bg-card p-6 text-card-foreground"
      position="left"
    >
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-display text-xl text-card-foreground">
            {quiz.titre}
          </h3>
          <span
            className={`rounded-sm px-2 py-0.5 text-xs font-medium ${
              quiz.statut === "publie"
                ? "bg-or/10 text-or"
                : quiz.statut === "archive"
                  ? "bg-muted text-muted-foreground"
                  : "bg-adire/10 text-adire"
            }`}
          >
            {quiz.statut === "publie" ? "Publié" : quiz.statut === "archive" ? "Archivé" : "Brouillon"}
          </span>
        </div>
        {quiz.categorie && <Rubrique>{quiz.categorie}</Rubrique>}
        <p className="text-sm text-muted-foreground">
          {quiz.questions_count} question
          {quiz.questions_count > 1 ? "s" : ""} · joué{" "}
          {quiz.sessions_count} fois · modifié le {formatDate(quiz.maj_le)}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          href={`/quiz/${quiz.id}`}
          aria-label="Modifier le quiz"
          className="inline-flex min-h-0 items-center justify-center rounded-sm px-2 py-2 text-foreground transition-colors hover:bg-adire/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Pencil className="size-4" aria-hidden="true" />
          <span className="sr-only">Modifier</span>
        </Link>
        <Button
          variant="ghost"
          size="md"
          className="min-h-0 px-2 py-2"
          aria-label="Dupliquer le quiz"
          loading={isDuplicating}
          onClick={handleDuplicate}
        >
          <Copy className="size-4" aria-hidden="true" />
          <span className="sr-only">Dupliquer</span>
        </Button>
        <Button
          variant="primary"
          size="md"
          className="min-h-0 px-2 py-2"
          aria-label="Lancer une session"
          loading={isLaunching}
          onClick={handleLaunch}
        >
          <Play className="size-4" aria-hidden="true" />
          <span className="sr-only">Lancer</span>
        </Button>
        <Button
          variant="ghost"
          size="md"
          className="min-h-0 px-2 py-2 text-rubrique hover:text-rubrique"
          aria-label="Supprimer le quiz"
          loading={isDeleting}
          onClick={handleDelete}
        >
          <Trash2 className="size-4" aria-hidden="true" />
          <span className="sr-only">Supprimer</span>
        </Button>
      </div>
    </RuleFrame>
  );
}
