import { Check, LoaderCircle, TriangleAlert } from "lucide-react";
import { EtatErreur } from "../../components/ui/etat-erreur";
import { cn } from "../../components/ui/cn";
import type { StatutEnreg } from "./file-enregistrement";

const LIBELLES: Record<StatutEnreg, string> = {
  enregistre: "Enregistré",
  en_cours: "Enregistrement…",
  echec: "Non enregistré",
  attente: "En attente",
};

// Région status : un lecteur d'écran annonce chaque changement sans voler le focus.
export function StatutEnregistrement({ statut, className }: { statut: StatutEnreg; className?: string }) {
  return (
    <span
      role="status"
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

