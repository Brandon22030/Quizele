import { useState, type FormEvent } from "react";
import { Button } from "../../components/ui/button";
import { EtatErreur } from "../../components/ui/etat-erreur";
import { FormField } from "../../components/ui/form-field";
import { Input } from "../../components/ui/input";
import { Papier } from "../../components/ui/papier";
import { localNow } from "../../shared/clock";
import { demanderLienMagique, demanderUrlGoogle, memoriserEnvoi, urlVerification, validerEmail } from "./logique";

interface Props {
  google: boolean;
  magicLink: boolean;
  /** Chemin interne déjà validé par safeReturnPath côté serveur. */
  retour: string;
  /** Message issu du paramètre `error` de Better Auth (lien expiré, refus Google), déjà traduit. */
  erreurInitiale: string | null;
}

type Attente = "google" | "mail" | null;

export default function Connexion({ google, magicLink, retour, erreurInitiale }: Props) {
  const [attente, setAttente] = useState<Attente>(null);
  const [erreur, setErreur] = useState<string | null>(erreurInitiale);
  const [erreurEmail, setErreurEmail] = useState<string | undefined>();
  const [email, setEmail] = useState("");

  async function continuerAvecGoogle() {
    if (attente) return;
    setErreur(null);
    setAttente("google");
    const resultat = await demanderUrlGoogle(retour);
    if (resultat.ok) {
      // Le chargement reste affiché : la page quitte le site pour Google.
      window.location.assign(resultat.donnees);
      return;
    }
    setErreur(resultat.message);
    setAttente(null);
  }

  async function envoyerLien(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    if (attente) return;
    setErreur(null);
    const verification = validerEmail(email);
    if (!verification.ok) {
      setErreurEmail(verification.message);
      return;
    }
    setErreurEmail(undefined);
    setAttente("mail");
    const resultat = await demanderLienMagique(verification.email, retour);
    if (resultat.ok) {
      memoriserEnvoi(sessionStorage, localNow(), verification.email);
      window.location.assign(urlVerification(retour));
      return;
    }
    setErreur(resultat.message);
    setAttente(null);
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-4 text-left">
      {erreur ? <EtatErreur titre="Connexion impossible">{erreur}</EtatErreur> : null}
      <Papier className="flex flex-col gap-4">
        {google ? (
          <Button bloc chargement={attente === "google"} libelleChargement="Redirection vers Google en cours" onClick={continuerAvecGoogle}>
            Continuer avec Google
          </Button>
        ) : null}
        {google && magicLink ? (
          <p aria-hidden="true" className="text-center text-sm font-extrabold text-vert-mousse">
            ou
          </p>
        ) : null}
        {magicLink ? (
          <form noValidate onSubmit={envoyerLien} className="flex flex-col gap-4">
            <FormField label="Ton adresse e-mail" aide="Tu recevras un lien de connexion, sans mot de passe." erreur={erreurEmail}>
              {(champ) => (
                <Input
                  {...champ}
                  type="email"
                  name="email"
                  autoComplete="email"
                  inputMode="email"
                  placeholder="prenom@exemple.fr"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              )}
            </FormField>
            <Button
              type="submit"
              bloc
              variante={google ? "soleil" : "primaire"}
              chargement={attente === "mail"}
              libelleChargement="Envoi du lien en cours"
            >
              Recevoir un lien par e-mail
            </Button>
          </form>
        ) : null}
      </Papier>
    </div>
  );
}
