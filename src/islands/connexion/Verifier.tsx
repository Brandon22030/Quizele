import { useEffect, useState } from "react";
import { MailCheck } from "lucide-react";
import { Button } from "../../components/ui/button";
import { EtatErreur } from "../../components/ui/etat-erreur";
import { Explosion } from "../../components/ui/explosion";
import { TitreAffiche } from "../../components/ui/titre-affiche";
import { localNow } from "../../shared/clock";
import {
  demanderLienMagique,
  lireEmail,
  lireEnvoi,
  masquerEmail,
  memoriserEnvoi,
  secondesRestantes,
  urlErreurConnexion,
} from "./logique";

interface Props {
  retour: string;
  validiteMinutes: number;
}

export default function Verifier({ retour, validiteMinutes }: Props) {
  // La lecture du stockage se fait après l'hydratation : le rendu serveur n'a pas accès à sessionStorage.
  const [email, setEmail] = useState<string | null>(null);
  const [reste, setReste] = useState(0);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  // Le décompte se déduit de l'horodatage d'envoi gardé en sessionStorage : il survit à un rechargement.
  useEffect(() => {
    setEmail(lireEmail(sessionStorage));
    let depart = lireEnvoi(sessionStorage);
    if (depart === null) {
      depart = localNow();
      memoriserEnvoi(sessionStorage, depart);
    }
    const debut = depart;
    const maj = () => {
      const dernier = lireEnvoi(sessionStorage) ?? debut;
      setReste(secondesRestantes(dernier, localNow()));
    };
    maj();
    const minuteur = setInterval(maj, 1000);
    return () => clearInterval(minuteur);
  }, []);

  async function renvoyer() {
    if (!email || envoi || reste > 0) return;
    setErreur(null);
    setConfirmation(null);
    setEnvoi(true);
    const resultat = await demanderLienMagique(email, retour);
    setEnvoi(false);
    if (resultat.ok) {
      const maintenant = localNow();
      memoriserEnvoi(sessionStorage, maintenant);
      setReste(secondesRestantes(maintenant, maintenant));
      setConfirmation("Un nouveau lien vient de partir.");
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
        {email ? (
          <>
            Nous avons envoyé un lien de connexion à <span className="break-words">{masquerEmail(email)}</span>.
          </>
        ) : (
          "Si ton adresse est valide, un lien de connexion vient de partir."
        )}{" "}
        Il est valable {validiteMinutes} minutes. Pense à regarder dans les courriers indésirables.
      </p>
      <p role="status" className="min-h-6 text-base font-extrabold text-vert-foret">
        {confirmation}
      </p>
      {erreur ? <EtatErreur titre="Envoi impossible" className="w-full text-left">{erreur}</EtatErreur> : null}
      {email ? (
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
      ) : null}
      <Button href={urlErreurConnexion(retour)} bloc variante="creme" taille="petit">
        Changer d'adresse
      </Button>
    </div>
  );
}
