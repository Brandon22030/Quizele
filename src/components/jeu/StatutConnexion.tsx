import { Wifi } from "lucide-react";
import type { ConnectionStatus } from "../../client/realtime/game-socket";
import { Bouton } from "./Bouton";
import { Etoile } from "./Etoile";
import { Pilule } from "./Pilule";
import { cx } from "./cx";

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
  action: string;
}

// Statuts qui ne se défont pas : se reconnecter ne servirait à rien.
const terminaux: Record<"kicked" | "ended" | "rejected", Terminal> = {
  kicked: {
    badge: "OUPS",
    titre: "Tu as été retiré de la partie",
    texte: "L'animateur t'a retiré. Tu peux rejoindre une autre partie avec son code.",
    action: "Saisir un code",
  },
  ended: {
    badge: "FINI",
    titre: "Partie terminée",
    texte: "Cette partie est terminée. Merci d'avoir joué, rejoins la suivante avec un nouveau code.",
    action: "Saisir un code",
  },
  rejected: {
    badge: "OUPS",
    titre: "Lien invalide",
    texte: "Ce lien ne fonctionne plus. Vérifie le code auprès de l'animateur.",
    action: "Saisir un code",
  },
};

export function StatutConnexion({ status, rejoindreHref = "/", className }: Props) {
  if (status === "open") return null;

  if (status === "connecting" || status === "reconnecting") {
    return (
      <div className={cx("flex justify-center", className)}>
        <Pilule ton="foret">
          <span role="status" className="inline-flex items-center gap-2">
            <Wifi aria-hidden="true" className="size-4.5 text-jaune-soleil" />
            {status === "connecting" ? "Connexion…" : "Connexion perdue, reprise en cours…"}
          </span>
        </Pilule>
      </div>
    );
  }

  const t = terminaux[status];
  return (
    <section role="alert" className={cx("px-6 pt-12 text-center", className)}>
      <Etoile ton={status === "ended" ? "creme" : "piment"} className="mx-auto w-37.5 rotate-5">
        <b className="font-badge text-3xl tracking-wider">{t.badge}</b>
      </Etoile>
      <h1 className="mt-6 font-affiche text-2xl">{t.titre}</h1>
      <p className="mt-2 font-semibold">{t.texte}</p>
      <Bouton bloc href={rejoindreHref} className="mt-8">
        {t.action}
      </Bouton>
    </section>
  );
}
