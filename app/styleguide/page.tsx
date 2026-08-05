"use client";

import { useEffect, useState } from "react";
import { Plus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ReglureMarge } from "@/components/ui/reglure-marge";
import { Rubrique } from "@/components/ui/rubrique";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <h2 className="font-display text-2xl text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function ColorSwatch({
  name,
  value,
  className,
}: {
  name: string;
  value: string;
  className: string;
}) {
  return (
    <div className="space-y-2">
      <div className={`h-16 rounded-sm border border-adire ${className}`} />
      <div className="space-y-0.5">
        <p className="text-sm font-medium text-foreground">{name}</p>
        <p className="text-xs font-mono text-muted-foreground uppercase">
          {value}
        </p>
      </div>
    </div>
  );
}

function TypeScale({
  name,
  className,
  sample,
}: {
  name: string;
  className: string;
  sample: string;
}) {
  return (
    <div className="flex items-baseline justify-between border-b border-adire/30 py-3">
      <p className={className}>{sample}</p>
      <span className="text-xs font-mono text-muted-foreground">{name}</span>
    </div>
  );
}

function ToastButtons() {
  const { addToast } = useToast();

  return (
    <div className="flex flex-wrap gap-4">
      <Button
        variant="primary"
        onClick={() =>
          addToast({
            title: "Réponse envoyée",
            description: "L'équipe a bien répondu.",
            variant: "success",
          })
        }
      >
        Succès
      </Button>
      <Button
        variant="secondary"
        onClick={() =>
          addToast({
            title: "Informations",
            description: "La session commencera à 20 h.",
            variant: "info",
          })
        }
      >
        Info
      </Button>
      <Button
        variant="destructive"
        onClick={() =>
          addToast({
            title: "Code invalide",
            description: "Vérifiez les six caractères et réessayez.",
            variant: "error",
          })
        }
      >
        Erreur
      </Button>
    </div>
  );
}

type DemoTimestamps = {
  serverNow: string;
  startedAt: string;
};

export default function StyleguidePage() {
  const [isLoading, setIsLoading] = useState(false);
  const [demoTimestamps, setDemoTimestamps] = useState<DemoTimestamps | null>(
    null
  );

  useEffect(() => {
    const handle = requestAnimationFrame(() => {
      const now = Date.now();
      setDemoTimestamps({
        serverNow: new Date(now).toISOString(),
        startedAt: new Date(now - 5000).toISOString(),
      });
    });
    return () => cancelAnimationFrame(handle);
  }, []);

  return (
    <main className="mx-auto max-w-3xl space-y-16 px-4 py-8">
      <header className="space-y-2 border-b border-adire pb-6">
        <h1 className="font-display text-3xl text-foreground">
          Styleguide Quizele
        </h1>
        <p className="text-base text-muted-foreground">
          Direction artistique « Encre et Indigo » — mobile d&apos;abord.
        </p>
      </header>

      <Section title="Palette">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <ColorSwatch name="Encre" value="#0E1626" className="bg-encre" />
          <ColorSwatch name="Indigo" value="#2B3F8C" className="bg-indigo" />
          <ColorSwatch name="Adire" value="#6B7FD1" className="bg-adire" />
          <ColorSwatch name="Craie" value="#F3F0E7" className="bg-craie" />
          <ColorSwatch
            name="Rubrique"
            value="#B8402E"
            className="bg-rubrique"
          />
          <ColorSwatch name="Or" value="#C8963E" className="bg-or" />
        </div>
      </Section>

      <Section title="Échelle typographique">
        <div className="space-y-0">
          <TypeScale
            name="12px / utilitaire"
            className="text-xs font-sans"
            sample="Note de marge"
          />
          <TypeScale
            name="14px / corps secondaire"
            className="text-sm font-sans"
            sample="Explication d'une réponse"
          />
          <TypeScale
            name="16px / corps"
            className="text-base font-sans"
            sample="Texte courant de l'interface"
          />
          <TypeScale
            name="20px / question"
            className="text-lg font-display"
            sample="Énoncé d'une question"
          />
          <TypeScale
            name="26px / titre de section"
            className="text-xl font-display"
            sample="Titre de page"
          />
          <TypeScale
            name="34px / titre principal"
            className="text-2xl font-display"
            sample="Score final"
          />
          <TypeScale
            name="48px / score"
            className="text-3xl font-mono"
            sample="1 240 pts"
          />
        </div>
      </Section>

      <Section title="Rubrique">
        <Rubrique>Chapitre 1 — La Création</Rubrique>
      </Section>

      <Section title="Boutons">
        <div className="space-y-6">
          <div className="flex flex-wrap gap-4">
            <Button variant="primary" size="md">
              Principal md
            </Button>
            <Button variant="secondary" size="md">
              Secondaire md
            </Button>
            <Button variant="ghost" size="md">
              Discret md
            </Button>
            <Button variant="destructive" size="md">
              Rubrique md
            </Button>
          </div>
          <div className="flex flex-wrap gap-4">
            <Button variant="primary" size="lg">
              Principal lg
            </Button>
            <Button variant="secondary" size="lg">
              Secondaire lg
            </Button>
            <Button variant="primary" disabled>
              Désactivé
            </Button>
          </div>
          <div className="flex flex-wrap gap-4">
            <Button
              variant="primary"
              loading={isLoading}
              onClick={() => {
                setIsLoading(true);
                setTimeout(() => setIsLoading(false), 2000);
              }}
            >
              {isLoading ? "Envoi en cours" : "Simuler l'envoi"}
            </Button>
          </div>
        </div>
      </Section>

      <Section title="Formulaires">
        <div className="space-y-6">
          <FormField
            id="team-name"
            label="Nom de l'équipe"
            help="Ce nom sera affiché pendant la session."
          >
            <Input placeholder="Ex. : Les Bereens" />
          </FormField>
          <FormField
            id="session-code"
            label="Code de session"
            error="Le code doit comporter six caractères. Vérifiez votre invitation."
          >
            <Input placeholder="ABC 123" defaultValue="ABC" />
          </FormField>
          <FormField
            id="question"
            label="Énoncé de la question"
            help="Minimum 20 px pour être lu à bout de bras."
          >
            <Textarea placeholder="Saisissez la question ici..." />
          </FormField>
        </div>
      </Section>

      <Section title="Cartes">
        <div className="space-y-4">
          <Card>
            <Rubrique className="mb-2 inline-block">Question 12</Rubrique>
            <h3 className="font-display text-xl text-card-foreground">
              Carte de quiz
            </h3>
            <p className="mt-2 text-base text-card-foreground">
              Contenu structuré avec une bordure Adire de 1px et un rayon de
              6px.
            </p>
            <div className="mt-4">
              <Button variant="primary">Continuer</Button>
            </div>
          </Card>
        </div>
      </Section>

      <Section title="État vide">
        <EmptyState
          icon={<Search className="size-8" />}
          title="Aucune session trouvée"
          description="Rejoignez une session existante ou créez la vôtre pour commencer à jouer."
          action={
            <Button variant="primary">
              <Plus className="size-4" aria-hidden="true" />
              Créer une session
            </Button>
          }
        />
      </Section>

      <Section title="Squelette de chargement">
        <div className="space-y-3">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <div className="flex gap-3 pt-2">
            <Skeleton className="size-12 rounded-sm" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          </div>
        </div>
      </Section>

      <Section title="Réglure de marge">
        <p className="text-sm text-muted-foreground">
          Le chronomètre se vide du haut vers le bas, calé sur l&apos;horodatage
          serveur. Il passe en rubrique et pulse lentement sur les cinq
          dernières secondes.
        </p>
        {demoTimestamps ? (
          <ReglureMarge
            durationMs={15000}
            startedAt={demoTimestamps.startedAt}
            serverNow={demoTimestamps.serverNow}
            onExpire={() => console.log("expiré")}
          />
        ) : (
          <Skeleton className="h-24 w-full rounded-md" />
        )}
      </Section>

      <Section title="Notifications">
        <p className="text-sm text-muted-foreground">
          Les notifications adoptent les couleurs du projet : or pour le
          succès, rubrique pour l&apos;erreur, indigo pour l&apos;information.
        </p>
        <ToastButtons />
      </Section>

      <Section title="Les deux thèmes">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-md border border-adire bg-craie p-6 text-encre">
            <h3 className="font-display text-xl">Thème Craie</h3>
            <p className="mt-2 text-base">
              Pour créer et lire dans la lumière.
            </p>
            <div className="mt-4 flex gap-2">
              <div className="h-12 w-12 rounded-sm bg-encre" />
              <div className="h-12 w-12 rounded-sm bg-indigo" />
              <div className="h-12 w-12 rounded-sm bg-adire" />
              <div className="h-12 w-12 rounded-sm border border-adire bg-craie" />
              <div className="h-12 w-12 rounded-sm bg-rubrique" />
              <div className="h-12 w-12 rounded-sm bg-or" />
            </div>
          </div>
          <div className="rounded-md border border-adire bg-encre p-6 text-craie">
            <h3 className="font-display text-xl">Thème Encre</h3>
            <p className="mt-2 text-base">
              Pour jouer, le soir, en salle peu éclairée.
            </p>
            <div className="mt-4 flex gap-2">
              <div className="h-12 w-12 rounded-sm border border-adire bg-encre" />
              <div className="h-12 w-12 rounded-sm bg-indigo" />
              <div className="h-12 w-12 rounded-sm bg-adire" />
              <div className="h-12 w-12 rounded-sm bg-craie" />
              <div className="h-12 w-12 rounded-sm bg-rubrique" />
              <div className="h-12 w-12 rounded-sm bg-or" />
            </div>
          </div>
        </div>
      </Section>
    </main>
  );
}
