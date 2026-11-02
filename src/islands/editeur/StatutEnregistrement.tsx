import { useEffect, useState } from "react";
import { Check, LoaderCircle, RotateCw, TriangleAlert, X } from "lucide-react";
import { Button } from "../../components/ui/button";
import { EtatErreur } from "../../components/ui/etat-erreur";
import { cn } from "../../components/ui/cn";
import { ANNONCE_INITIALE, annoncerStatut } from "./annonces";
import type { Avis, StatutEnreg } from "./file-enregistrement";

const LIBELLES: Record<StatutEnreg, string> = {
  enregistre: "Enregistré",
  en_cours: "Enregistrement…",
  echec: "Non enregistré",
  attente: "En attente",
};

// Indicateur visuel seulement : il change à chaque frappe, AnnonceEnregistrement dit ce qui compte au lecteur d'écran.
export function StatutEnregistrement({ statut, className }: { statut: StatutEnreg; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-pill border-trait px-2 text-xs font-extrabold whitespace-nowrap",
        statut === "echec" ? "border-piment bg-piment text-creme" : "border-vert-foret bg-creme text-vert-foret",
        className,
      )}
    >
      {statut === "enregistre" ? <Check aria-hidden="true" className="size-4" strokeWidth={3} /> : null}
      {statut === "en_cours" ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : null}
      {statut === "echec" ? <TriangleAlert aria-hidden="true" className="size-4" /> : null}
      {LIBELLES[statut]}
    </span>
  );
}

interface MessageProps {
  statut: StatutEnreg;
  message: string | null;
  code: string | null;
  retour: string;
  onRetry: () => void;
}

// Échec : les modifications restent sur l'appareil, la nouvelle tentative est un bouton de 44 px. Attente : une règle à remplir
// (titre vide), pas une panne.
export function MessageEnregistrement({ statut, message, code, retour, onRetry }: MessageProps) {
  if (statut === "attente" && message) {
    return (
      <p role="status" className="mx-4 my-3 rounded-md border-trait border-dashed border-vert-foret bg-creme p-3 text-sm font-extrabold">
        {message}
      </p>
    );
  }
  if (statut !== "echec" || !message) return null;
  return (
    <div className="mx-4 my-3">
      <EtatErreur titre="Non enregistré" onRetry={onRetry} libelleRetry="Réessayer maintenant">
        {message}
        {code === "UNAUTHORIZED" ? (
          <>
            {" "}
            <a href={`/connexion?retour=${encodeURIComponent(retour)}`} className="inline-flex min-h-11 items-center underline">
              Se reconnecter
            </a>
          </>
        ) : null}
      </EtatErreur>
    </div>
  );
}


// Région présente dès le montage : une région live insérée en même temps que son texte n'est pas annoncée partout.
export function AnnonceEnregistrement({ statut }: { statut: StatutEnreg }) {
  const [etat, setEtat] = useState(ANNONCE_INITIALE);
  useEffect(() => setEtat((precedent) => annoncerStatut(precedent, statut)), [statut]);
  return (
    <p role="status" className="sr-only">
      {etat.texte}
    </p>
  );
}

interface AvisProps {
  avis: Avis | null;
  onRecharger: () => void;
  onFermer: () => void;
}

// Le quiz a changé ailleurs : rien n'est bloqué, la file continue. Région persistante pour la même raison qu'au-dessus.
export function AvisEditeur({ avis, onRecharger, onFermer }: AvisProps) {
  return (
    <div role="status" className={avis ? "mx-4 my-3" : undefined}>
      {avis ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border-trait border-vert-foret bg-creme p-3 text-vert-foret">
          <p className="min-w-0 flex-1 text-sm font-extrabold">{avis.message}</p>
          <div className="flex items-center gap-2">
            {avis.recharger ? (
              <Button taille="petit" variante="primaire" onClick={onRecharger}>
                <RotateCw aria-hidden="true" className="size-5" />
                Recharger
              </Button>
            ) : null}
            <button
              type="button"
              onClick={onFermer}
              aria-label="Masquer ce message"
              className="grid size-11 shrink-0 place-items-center rounded-sm text-vert-foret"
            >
              <X aria-hidden="true" className="size-5" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
