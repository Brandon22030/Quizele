import type { ReactNode } from "react";
import { BookOpen, Heart, LoaderCircle, Pencil, Sparkles } from "lucide-react";
import { Button } from "../../components/ui/button";
import { EtatErreur } from "../../components/ui/etat-erreur";
import { BadgeEtoile } from "../../components/ui/badge-etoile";
import { TitreAffiche } from "../../components/ui/titre-affiche";
import { descriptionModele, type ModeleCarte } from "./logique";

const ICONES: ReactNode[] = [
  <BookOpen key="livre" className="size-6" />,
  <Heart key="coeur" className="size-6" />,
  <Sparkles key="etincelle" className="size-6" />,
];

interface ChoixDemarrageProps {
  modeles: ModeleCarte[];
  modeleEnCours: string | null;
  erreur: string | null;
  onChoisir: (modeleId: string) => void;
  /** Le titre d'affiche remplace « Tes quiz » quand la page n'a ni quiz ni onglets (écran k2). */
  avecTitre?: boolean;
}

// Écran k2 : la première visite propose « Partir de zéro » ou un des modèles livrés.
export function ChoixDemarrage({ modeles, modeleEnCours, erreur, onChoisir, avecTitre = true }: ChoixDemarrageProps) {
  return (
    <section aria-labelledby="demarrage-titre" className="flex flex-col gap-4 px-4">
      {avecTitre ? (
        <div className="pt-4 text-center">
          <TitreAffiche id="demarrage-titre" tabIndex={-1} className="-rotate-3 text-4xl outline-none">
            TON 1ER
            <br />
            QUIZ
          </TitreAffiche>
          <p className="mt-4 font-bold">Un titre, quelques questions, et ta salle peut jouer. Compte 10 minutes.</p>
        </div>
      ) : (
        <h2 id="demarrage-titre" className="sr-only">
          Créer ton premier quiz
        </h2>
      )}
      <Button href="/quiz/nouveau" bloc className="mt-2">
        <Pencil aria-hidden="true" className="size-5" />
        Partir de zéro
      </Button>
      <h2 className="mt-3 font-affiche text-lg">Ou partir d'un modèle</h2>
      {erreur ? <EtatErreur>{erreur}</EtatErreur> : null}
      <ul className="flex flex-col gap-4">
        {modeles.map((modele, index) => {
          const enCours = modeleEnCours === modele.id;
          return (
            <li key={modele.id}>
              <button
                type="button"
                // aria-disabled plutôt que disabled : le bouton cliqué garde le focus pendant la création.
                aria-disabled={modeleEnCours !== null || undefined}
                aria-busy={enCours || undefined}
                onClick={() => {
                  if (modeleEnCours === null) onChoisir(modele.id);
                }}
                data-papier=""
                className="flex min-h-14 w-full items-center gap-3 rounded-md border-trait border-vert-foret bg-creme p-3 text-left text-vert-foret shadow-relief-sm"
              >
                <BadgeEtoile variante="soleil" className="size-14 shrink-0">
                  {enCours ? <LoaderCircle aria-hidden="true" className="size-6 animate-spin motion-reduce:animate-none" /> : ICONES[index % ICONES.length]}
                </BadgeEtoile>
                <span className="min-w-0 flex-1">
                  <span className="block font-affiche text-lg leading-tight break-words">{modele.title}</span>
                  <span className="block text-sm font-semibold text-vert-mousse">{enCours ? "Création en cours..." : descriptionModele(modele)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="my-4 -rotate-2 text-center font-note text-xl">{"Tout se modifie ensuite\u202f!"}</p>
    </section>
  );
}
