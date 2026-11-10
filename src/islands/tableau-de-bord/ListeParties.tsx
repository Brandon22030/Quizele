import { ChevronRight, Clock } from "lucide-react";
import { EtatErreur } from "../../components/ui/etat-erreur";
import { EtatVide } from "../../components/ui/etat-vide";
import { useCoteClient } from "./date-locale";
import { dateLongue, jourMois, libelleJoueurs, urlBilan, type PartieJouee } from "./logique";

interface ListePartiesProps {
  parties: PartieJouee[] | null;
  onReessayer: () => void;
}

export function ListeParties({ parties, onReessayer }: ListePartiesProps) {
  const client = useCoteClient();
  if (parties === null) {
    return (
      <EtatErreur titre="Parties indisponibles" onRetry={onReessayer} className="mt-5">
        Impossible de charger tes parties jouées pour le moment.
      </EtatErreur>
    );
  }
  if (parties.length === 0) {
    return (
      <EtatVide icone={<Clock className="size-10" />} titre="Aucune partie jouée">
        Lance un quiz avec ta salle : le classement et les questions à revoir arriveront ici.
      </EtatVide>
    );
  }
  return (
    <>
      <ul className="mt-5 flex flex-col gap-4">
        {parties.map((partie) => {
          const date = new Date(partie.jouee);
          const { jour, mois } = client ? jourMois(date) : { jour: "", mois: "" };
          return (
            <li
              key={partie.id}
              data-papier=""
              className="flex items-center gap-3 rounded-md border-trait border-vert-foret bg-creme p-3 text-vert-foret shadow-relief-sm"
            >
              <time dateTime={date.toISOString()} className="block w-14 shrink-0 text-center font-affiche leading-none">
                <span className="block text-2xl">{jour}</span>
                <span className="mt-1 block text-xs font-extrabold">{mois}</span>
              </time>
              <div className="min-w-0 flex-1">
                <p className="font-affiche text-lg leading-tight break-words">{partie.quizTitle}</p>
                <p className="text-sm font-semibold text-vert-mousse">{libelleJoueurs(partie.playerCount)}</p>
              </div>
              <a
                href={urlBilan(partie.id)}
                aria-label={client ? `Voir le bilan de ${partie.quizTitle}, ${dateLongue(date)}` : `Voir le bilan de ${partie.quizTitle}`}
                className="grid size-11 shrink-0 place-items-center rounded-sm border-trait border-vert-foret bg-jaune-soleil text-vert-foret shadow-relief-sm"
              >
                <ChevronRight aria-hidden="true" className="size-5" />
              </a>
            </li>
          );
        })}
      </ul>
      <p className="px-6 pt-5 text-center text-sm font-semibold">Les bilans sont conservés 90 jours après la partie.</p>
    </>
  );
}
