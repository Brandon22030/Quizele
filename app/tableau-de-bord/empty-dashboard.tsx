"use client";

import { useTransition } from "react";
import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { createSampleQuiz } from "@/app/tableau-de-bord/actions";

export function EmptyDashboard() {
  const { addToast } = useToast();
  const [isPending, startTransition] = useTransition();

  function handleCreateSample() {
    startTransition(async () => {
      try {
        await createSampleQuiz();
        addToast({
          title: "Modèle créé",
          description: "Votre premier quiz est prêt à être personnalisé.",
          variant: "success",
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes("NEXT_REDIRECT")) {
          throw error;
        }
        addToast({
          title: "Erreur",
          description: error instanceof Error ? error.message : "Réessayez.",
          variant: "error",
        });
      }
    });
  }

  return (
    <EmptyState
      icon={<Sparkles className="size-8" />}
      title="Aucun quiz pour l'instant"
      description="Crée ton premier quiz, ou laisse-toi guider par un modèle prérempli pour comprendre le fonctionnement."
      action={
        <Button
          variant="primary"
          size="lg"
          loading={isPending}
          onClick={handleCreateSample}
        >
          <Sparkles className="size-4" aria-hidden="true" />
          Créer un modèle de quiz
        </Button>
      }
    />
  );
}
