import { useEffect, useRef } from "react";
import { Users, X } from "lucide-react";
import type { PlayerInfo } from "../../shared/protocol";
import { PuceJoueur } from "../../components/jeu";
import { IconButton } from "../../components/ui/button";
import { EtatVide } from "../../components/ui/etat-vide";
import { libelleParticipants } from "./logique";

interface Props {
  joueurs: PlayerInfo[];
  total: number;
  onRetirer: (joueur: PlayerInfo) => void;
  /** Identifiant du joueur dont le retrait vient d'être demandé : à sa disparition, le focus revient au titre. */
  retraitDemande: string | null;
  onRetraitTermine: () => void;
}

export function ParticipantsHote({ joueurs, total, onRetirer, retraitDemande, onRetraitTermine }: Props) {
  const titre = useRef<HTMLHeadingElement>(null);

  // Le bouton du joueur retiré disparaît avec sa puce : sans cela le focus retomberait sur body.
  useEffect(() => {
    if (retraitDemande && !joueurs.some((j) => j.id === retraitDemande)) {
      titre.current?.focus();
      onRetraitTermine();
    }
  }, [joueurs, retraitDemande, onRetraitTermine]);

  return (
    <section aria-labelledby="titre-participants">
      <h2 id="titre-participants" ref={titre} tabIndex={-1} className="font-affiche text-xl text-jaune-soleil outline-none">
        Participants ({total})
      </h2>
      {joueurs.length === 0 ? (
        <EtatVide icone={<Users className="size-10" />} titre="Personne n'est encore là">
          Montre le code ou le QR à la salle. Les joueurs apparaissent ici dès qu'ils rejoignent.
        </EtatVide>
      ) : (
        <ul aria-label={libelleParticipants(joueurs.length)} className="m-0 mt-3 flex list-none flex-wrap gap-2 p-0 text-vert-foret">
          {joueurs.map((joueur) => (
            <li key={joueur.id} className="flex items-center gap-1">
              <PuceJoueur pseudo={joueur.pseudo} />
              <IconButton label={`Retirer ${joueur.pseudo}`} icone={<X className="size-5" />} danger onClick={() => onRetirer(joueur)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
