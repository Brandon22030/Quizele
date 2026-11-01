import { Wifi } from "lucide-react";
import type { ConnectionStatus } from "../../client/realtime/game-socket";
import { Button } from "../ui/button";
import { Forme } from "../ui/forme";
import { Pilule } from "../ui/pilule";
import { cn } from "../ui/cn";

interface Props {
  status: ConnectionStatus;
  // Page de saisie du code, cible de l'action des écrans terminaux.
  rejoindreHref?: string;
  className?: string;
}

interface Terminal {
  badge: string;
  titre: string;
  texte: string;
}

// Statuts qui ne se défont pas : se reconnecter ne servirait à rien.
const terminaux: Record<"kicked" | "ended" | "rejected", Terminal> = {
  kicked: {
    badge: "OUPS",
    titre: "Tu as été retiré de la partie",
    texte: "L'animateur t'a retiré. Tu peux rejoindre une autre partie avec son code.",
  },
  ended: {
    badge: "FINI",
    titre: "Partie terminée",
    texte: "Cette partie est terminée. Merci d'avoir joué, rejoins la suivante avec un nouveau code.",
  },
  rejected: {
    badge: "OUPS",
    titre: "Lien invalide",
    texte: "Ce lien ne fonctionne plus. Vérifie le code auprès de l'animateur.",
  },
};

export function StatutConnexion({ status, rejoindreHref = "/", className }: Props) {
  const transitoire = status === "connecting" || status === "reconnecting";
  const terminal = status === "kicked" || status === "ended" || status === "rejected" ? terminaux[status] : null;

  return (
    <>
      {/* Région toujours présente (vide quand tout va bien) : une région insérée avec son texte est annoncée de façon peu fiable. */}
      <div role="status" className={cn("flex justify-center", className)}>
        {transitoire ? (
          <Pilule variante="foret">
            <Wifi aria-hidden="true" className="size-5 text-jaune-soleil" />
            {status === "connecting" ? "Connexion…" : "Connexion perdue, reprise en cours…"}
          </Pilule>
        ) : null}
      </div>
      {terminal ? (
        <section role="alert" className={cn("px-6 pt-12 text-center", className)}>
          <div className="mx-auto w-badge-petit rotate-5">
            <Forme forme="etoile" variante={status === "ended" ? "creme" : "piment"} className="size-full">
              <b className="font-badge text-3xl tracking-wider">{terminal.badge}</b>
            </Forme>
          </div>
          <h1 className="mt-6 font-affiche text-2xl">{terminal.titre}</h1>
          <p className="mt-2 font-semibold">{terminal.texte}</p>
          <Button bloc href={rejoindreHref} className="mt-8">
            Saisir un code
          </Button>
        </section>
      ) : null}
    </>
  );
}
