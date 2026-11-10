import { ChevronLeft } from "lucide-react";
import { Button } from "../../components/ui/button";
import { EtatErreur } from "../../components/ui/etat-erreur";
import { Squelette } from "../../components/ui/squelette";
import { EditeurPret } from "./EditeurPret";
import { LienIcone } from "./LienIcone";
import { useEditeur } from "./useEditeur";

interface Props {
  // Null pour /quiz/nouveau : le quiz n'existe qu'à la première sauvegarde.
  quizId: string | null;
  // Numéro (à partir de 1) de la question à ouvrir, lu dans ?question= par la page.
  question?: number;
}

export default function Editeur({ quizId, question }: Props) {
  const { phase, recharger } = useEditeur(quizId);
  if (phase.nom === "pret") return <EditeurPret file={phase.file} question={question} />;
  return (
    <div className="trame-points min-h-dvh bg-jaune-soleil text-vert-foret">
      <header className="flex min-h-16 items-center gap-3 px-4 py-2">
        <LienIcone href="/tableau-de-bord" label="Retour au tableau de bord" icone={<ChevronLeft aria-hidden="true" className="size-6" />} />
        {phase.nom === "chargement" ? <Squelette className="h-6 flex-1" /> : <h1 className="font-affiche text-lg">Éditeur de quiz</h1>}
      </header>
      {phase.nom === "chargement" ? <EtatChargement /> : <ErreurOuverture {...phase} onRetry={recharger} />}
    </div>
  );
}

function EtatChargement() {
  return (
    <div role="status" aria-label="Chargement du quiz" className="flex flex-col gap-3 px-4">
      <div aria-hidden="true" className="flex gap-2">
        {[0, 1, 2].map((i) => (
          <Squelette key={i} className="size-11 rounded-sm" />
        ))}
      </div>
      <Squelette className="h-20 rounded-md" />
      <Squelette className="h-20 rounded-md" />
      <Squelette className="h-16 rounded-md" />
      <Squelette className="h-16 rounded-md" />
      <Squelette className="h-16 rounded-md" />
      <p className="mt-3 text-center font-affiche text-lg">Ouverture du quiz…</p>
    </div>
  );
}

function ErreurOuverture({ message, reessayable, onRetry }: { message: string; reessayable: boolean; onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-4 px-4">
      <EtatErreur titre="Impossible d'ouvrir ce quiz" onRetry={reessayable ? onRetry : undefined}>
        {message}
      </EtatErreur>
      <Button href="/tableau-de-bord" variante="creme">
        Retour au tableau de bord
      </Button>
    </div>
  );
}
