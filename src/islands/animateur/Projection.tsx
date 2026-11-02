import { useCallback, useEffect, useState } from "react";
import { actions } from "astro:actions";
import { useGameSession } from "../../client/realtime/use-game-session";
import { Button } from "../../components/ui/button";
import { EtatErreur } from "../../components/ui/etat-erreur";
import { Squelette } from "../../components/ui/squelette";
import { Cadre, VueProjection } from "./VueProjection";

function EcranProjete({ code, token, onFermer }: { code: string; token: string; onFermer: () => void }) {
  const getToken = useCallback(() => token, [token]);
  const { state } = useGameSession({ code, getToken });
  const [origine, setOrigine] = useState("");
  useEffect(() => setOrigine(window.location.origin), []);
  return <VueProjection state={state} code={code} origine={origine} onFermer={onFermer} />;
}

type Acces = { etat: "recherche" } | { etat: "pret"; code: string; token: string } | { etat: "echec"; message: string };

interface Props {
  sessionId: string;
  onFermer: () => void;
}

// Monté seulement pendant la projection : la seconde socket (rôle écran) n'existe pas le reste du temps. Le rôle écran reçoit
// la même correction que les joueurs, ce qui respecte le réglage « Montrer la bonne réponse » du quiz.
export function Projection({ sessionId, onFermer }: Props) {
  const [acces, setAcces] = useState<Acces>({ etat: "recherche" });

  useEffect(() => {
    let annule = false;
    actions.partie
      .jetonEcran({ sessionId })
      .then(({ data, error }) => {
        if (annule) return;
        setAcces(error ? { etat: "echec", message: error.message } : { etat: "pret", code: data.code, token: data.token });
      })
      .catch(() => !annule && setAcces({ etat: "echec", message: "Connexion impossible. Vérifie ta connexion puis réessaie." }));
    return () => {
      annule = true;
    };
  }, [sessionId]);

  if (acces.etat === "pret") return <EcranProjete code={acces.code} token={acces.token} onFermer={onFermer} />;
  return (
    <Cadre titre={acces.etat === "echec" ? "Projection impossible" : "Connexion à la partie"} onFermer={onFermer}>
      {acces.etat === "echec" ? (
        <>
          <EtatErreur titre="Projection impossible">{acces.message}</EtatErreur>
          <Button variante="creme" onClick={onFermer}>
            Quitter la projection
          </Button>
        </>
      ) : (
        <div aria-busy="true">
          <p role="status" className="sr-only">
            Connexion à la partie
          </p>
          <Squelette className="h-scene-basse w-full" />
        </div>
      )}
    </Cadre>
  );
}
