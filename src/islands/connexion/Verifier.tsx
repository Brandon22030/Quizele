import { useEffect, useState } from "react";
import { MailCheck } from "lucide-react";
import { Button } from "../../components/ui/button";
import { EtatErreur } from "../../components/ui/etat-erreur";
import { Explosion } from "../../components/ui/explosion";
import { TitreAffiche } from "../../components/ui/titre-affiche";
import { DELAI_RENVOI_SECONDES, demanderLienMagique, urlErreurConnexion } from "./logique";

interface Props {
  email: string;
  retour: string;
  validiteMinutes: number;
}

export default function Verifier({ email, retour, validiteMinutes }: Props) {
  const [reste, setReste] = useState(DELAI_RENVOI_SECONDES);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  // Compte à rebours en secondes entières : l'intervalle ne sert qu'à décompter, aucune heure n'est comparée.
  // Il ne dépend que de `relance` : le relancer à chaque seconde ferait glisser le décompte.
  const [relance, setRelance] = useState(0);
  useEffect(() => {
    setReste(DELAI_RENVOI_SECONDES);
    const minuteur = setInterval(() => setReste((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(minuteur);
  }, [relance]);

  async function renvoyer() {
    if (envoi || reste > 0) return;
    setErreur(null);
    setConfirmation(null);
    setEnvoi(true);
    const resultat = await demanderLienMagique(email, retour);
    setEnvoi(false);
    if (resultat.ok) {
      setConfirmation("Un nouveau lien vient de partir.");
      setRelance((n) => n + 1);
      return;
    }
    setErreur(resultat.message);
  }

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-5 text-center">
      <Explosion variante="creme">
        <MailCheck aria-hidden="true" className="size-12" />
      </Explosion>
      <TitreAffiche className="text-3xl">Regarde ta boîte mail</TitreAffiche>
      <p className="text-base font-bold text-vert-foret">
        Nous avons envoyé un lien de connexion à <span className="break-words">{email}</span>. Il est valable {validiteMinutes} minutes. Pense à
        regarder dans les courriers indésirables.
      </p>
      <p role="status" className="min-h-6 text-base font-extrabold text-vert-foret">
        {confirmation}
      </p>
      {erreur ? <EtatErreur titre="Envoi impossible" className="w-full text-left">{erreur}</EtatErreur> : null}
      <Button
        bloc
        variante="soleil"
        disabled={reste > 0}
        chargement={envoi}
        libelleChargement="Envoi du lien en cours"
        onClick={renvoyer}
      >
        {reste > 0 ? `Renvoyer le lien dans ${reste} s` : "Renvoyer le lien"}
      </Button>
      <Button href={urlErreurConnexion(retour)} bloc variante="creme" taille="petit">
        Changer d'adresse
      </Button>
    </div>
  );
}
