import type { ReactNode } from "react";
import { ArrowLeft, Check, LoaderCircle, TriangleAlert } from "lucide-react";
import { Button } from "../../components/ui/button";
import { EtatErreur } from "../../components/ui/etat-erreur";
import { FormField } from "../../components/ui/form-field";
import { Input, Textarea } from "../../components/ui/input";
import { Interrupteur } from "../../components/ui/interrupteur";
import { OptionMode } from "../../components/ui/option-mode";
import { Papier } from "../../components/ui/papier";
import { Repli } from "../../components/ui/repli";
import { Squelette } from "../../components/ui/squelette";
import { cn } from "../../components/ui/cn";
import { CATEGORY_MAX, LONG_TEXT_MAX, libelleStatut, urlEditeur, type DonneesReglages, type Reglages, type StatutEnregistrement } from "./logique";

interface CadreProps {
  quizId: string;
  titre?: string;
  statut?: StatutEnregistrement;
  annonce?: string;
  onRetour?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  children: ReactNode;
}

export function Cadre({ quizId, titre, statut = { etat: "repos" }, annonce = "", onRetour, children }: CadreProps) {
  const libelle = libelleStatut(statut);
  return (
    <div className="trame-points min-h-dvh pb-8">
      <div className="mx-auto w-full max-w-xl">
        <header className="flex items-center gap-3 px-4 pt-4">
          <a
            href={urlEditeur(quizId)}
            onClick={onRetour}
            aria-label="Retour à l'éditeur"
            className="grid size-11 shrink-0 place-items-center rounded-sm border-trait border-vert-foret bg-creme text-vert-foret shadow-relief-sm active:-translate-x-1 active:translate-y-1 active:shadow-relief-appui"
          >
            <ArrowLeft aria-hidden="true" className="size-5" />
          </a>
          <div className="flex min-w-0 flex-col items-start gap-1">
            <h1 className="font-affiche text-xl leading-tight">Réglages</h1>
            {titre ? <p className="max-w-full truncate text-sm font-bold text-vert-mousse">{titre}</p> : null}
          </div>
          {/* Région toujours montée : un statut inséré avec son texte est annoncé de façon peu fiable. */}
          <p aria-live="polite" className="sr-only">
            {annonce}
          </p>
          {/* Pilule visible, non annoncée (aria-live off) : la région sr-only ci-dessus porte les annonces utiles. */}
          <p role="status" aria-live="off" className="ml-auto shrink-0">
            {libelle ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-pill border-trait border-vert-foret bg-creme px-3 py-1 text-sm font-extrabold",
                  statut.etat === "echec" && "border-piment text-piment",
                )}
              >
                {statut.etat === "enregistrement" ? (
                  <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
                ) : statut.etat === "echec" ? (
                  <TriangleAlert aria-hidden="true" className="size-4" />
                ) : (
                  <Check aria-hidden="true" className="size-4" strokeWidth={3} />
                )}
                {libelle}
              </span>
            ) : null}
          </p>
        </header>
        <main className="px-4 pt-6">{children}</main>
      </div>
    </div>
  );
}

export function VueChargement({ quizId }: { quizId: string }) {
  return (
    <Cadre quizId={quizId}>
      <div aria-busy="true" className="flex flex-col gap-5">
        <p role="status" className="sr-only">
          Chargement des réglages
        </p>
        <Squelette className="h-8 w-2/3" />
        <Squelette className="h-16 w-full" />
        <Squelette className="h-16 w-full" />
        <Squelette className="h-scene-basse w-full" />
      </div>
    </Cadre>
  );
}

export function VueErreur({ quizId, message, onRetry }: { quizId: string; message: string; onRetry?: () => void }) {
  return (
    <Cadre quizId={quizId}>
      <EtatErreur titre="Réglages indisponibles" onRetry={onRetry}>
        {message}
      </EtatErreur>
      <Button href="/tableau-de-bord" variante="creme" taille="petit" className="mt-4">
        Retour à tes quiz
      </Button>
    </Cadre>
  );
}

interface VueProps {
  donnees: DonneesReglages;
  valeurs: Reglages;
  statut: StatutEnregistrement;
  annonce: string;
  onChange: (patch: Partial<Reglages>) => void;
  onTexte: (champ: "description" | "category", valeur: string) => void;
  onTexteTermine: () => void;
  onReessayer: () => void;
  onRetour: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}

export function VueReglages({ donnees, valeurs, statut, annonce, onChange, onTexte, onTexteTermine, onReessayer, onRetour }: VueProps) {
  return (
    <Cadre quizId={donnees.quizId} titre={donnees.title} statut={statut} annonce={annonce} onRetour={onRetour}>
      <div className="flex flex-col gap-6">
        {statut.etat === "echec" ? (
          <EtatErreur titre="Réglage non enregistré" onRetry={onReessayer}>
            {statut.message}
          </EtatErreur>
        ) : null}
        {statut.etat === "echec" ? (
          <Button href={urlEditeur(donnees.quizId)} variante="creme" taille="petit" className="self-start">
            Quitter sans enregistrer
          </Button>
        ) : null}
        <fieldset>
          <legend className="font-affiche text-xl">Comment on joue ?</legend>
          <div className="mt-3 flex flex-col gap-3">
            <OptionMode
              name="mode"
              value="together"
              titre="Tout le monde ensemble"
              description="Tu lances chaque question, la salle répond en même temps. Idéal avec un grand écran."
              checked={valeurs.mode === "together"}
              onChange={() => onChange({ mode: "together" })}
            />
            <OptionMode
              name="mode"
              value="own_pace"
              titre="Chacun à son rythme"
              description="Tu partages le lien, chacun joue quand il veut, même à la maison."
              checked={valeurs.mode === "own_pace"}
              onChange={() => onChange({ mode: "own_pace" })}
            />
          </div>
        </fieldset>
        <Papier className="my-0 py-2">
          <Interrupteur
            label="Montrer la bonne réponse"
            description="Après chaque question, avec l'explication."
            checked={valeurs.showCorrectAnswer}
            onChange={(e) => onChange({ showCorrectAnswer: e.target.checked })}
          />
          <div className="border-trait border-x-0 border-b-0 border-dashed border-vert-foret" />
          <Interrupteur
            label="Mélanger l'ordre"
            description="Questions et réponses, pour éviter de copier sur le voisin."
            checked={valeurs.shuffle}
            onChange={(e) => onChange({ shuffle: e.target.checked })}
          />
        </Papier>
        <Repli titre="Plus d'options" defaultOpen={Boolean(valeurs.description || valeurs.category)}>
          <FormField label="Description (visible par les joueurs)" aide={`${valeurs.description.length} sur ${LONG_TEXT_MAX} caractères`}>
            {(controle) => (
              <Textarea
                {...controle}
                rows={3}
                maxLength={LONG_TEXT_MAX}
                value={valeurs.description}
                onChange={(e) => onTexte("description", e.target.value)}
                onBlur={onTexteTermine}
              />
            )}
          </FormField>
          <FormField label="Catégorie" aide={`${CATEGORY_MAX} caractères au plus`}>
            {(controle) => (
              <Input
                {...controle}
                maxLength={CATEGORY_MAX}
                value={valeurs.category}
                onChange={(e) => onTexte("category", e.target.value)}
                onBlur={onTexteTermine}
              />
            )}
          </FormField>
        </Repli>
      </div>
    </Cadre>
  );
}
