"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { RuleFrame } from "@/components/ui/rule-frame";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";

import { joinSession } from "@/app/q/[code]/actions";

function formatDuration(seconds: number): string {
  const minutes = Math.ceil(seconds / 60);
  return minutes < 1 ? "< 1 min" : `~ ${minutes} min`;
}

export function QuizWelcome({
  code,
  statut,
  titre,
  description,
  couvertureUrl,
  animateur,
  questionsCount,
  estimatedDuration,
}: {
  code: string;
  statut: "attente" | "ouverte";
  titre: string;
  description: string;
  couvertureUrl: string | null;
  animateur: string;
  questionsCount: number;
  estimatedDuration: number;
}) {
  const router = useRouter();
  const { addToast } = useToast();
  const supabase = useMemo(() => createClient(), []);

  const [pseudo, setPseudo] = useState("");
  const [isJoining, setIsJoining] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function ensureAnonymous() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user) return;

      const { error } = await supabase.auth.signInAnonymously();
      if (error && mounted) {
        addToast({
          title: "Connexion impossible",
          description: error.message,
          variant: "error",
        });
      }
    }

    void ensureAnonymous();

    return () => {
      mounted = false;
    };
  }, [supabase, addToast]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = pseudo.trim();
    if (!trimmed) {
      addToast({
        title: "Pseudo requis",
        description: "Choisis un pseudo pour rejoindre la partie.",
        variant: "error",
      });
      return;
    }

    setIsJoining(true);
    try {
      const result = await joinSession(code, trimmed);
      if (result.reprise) {
        addToast({
          title: "Reprise de ta partie",
          description: "Tu reprends où tu t'es arrêté.",
          variant: "info",
        });
      }
      router.push(`/q/${code}/jouer?participant_id=${result.participant_id}`);
    } catch (error) {
      addToast({
        title: "Impossible de rejoindre",
        description:
          error instanceof Error
            ? error.message
            : "Vérifie le code ou réessaie plus tard.",
        variant: "error",
      });
    } finally {
      setIsJoining(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4">
      <RuleFrame
        className="w-full max-w-md space-y-6 rounded-md border border-adire bg-card p-6 text-center text-card-foreground"
        position="top"
      >
        {couvertureUrl && (
          <div className="relative mx-auto aspect-video w-full max-w-xs overflow-hidden rounded-sm">
            <Image
              src={couvertureUrl}
              alt={titre}
              fill
              className="object-cover"
              priority
            />
          </div>
        )}

        <div>
          <h1 className="font-display text-2xl text-foreground">{titre}</h1>
          {description && (
            <p className="mt-2 text-sm text-muted-foreground">{description}</p>
          )}
        </div>

        <ul className="space-y-1 text-sm text-muted-foreground">
          <li>Animé par <span className="text-foreground">{animateur}</span></li>
          <li>
            {questionsCount} question{questionsCount > 1 ? "s" : ""}
          </li>
          <li>Durée estimée : {formatDuration(estimatedDuration)}</li>
        </ul>

        {statut === "attente" && (
          <p className="rounded-sm bg-adire/10 p-3 text-sm text-foreground">
            La session n&apos;a pas encore commencé. Tu peux déjà t&apos;inscrire, l&apos;animateur lancera les questions.
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-left">
          <FormField id="pseudo" label="Pseudo" error={undefined}>
            <Input
              id="pseudo"
              value={pseudo}
              onChange={(event) => setPseudo(event.target.value)}
              placeholder="Ton pseudo"
              maxLength={20}
              autoComplete="off"
              autoFocus
            />
          </FormField>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="w-full"
            loading={isJoining}
          >
            Rejoindre
          </Button>
        </form>
      </RuleFrame>
    </main>
  );
}
