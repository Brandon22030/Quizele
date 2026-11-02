import { useCallback, useEffect, useRef, useState } from "react";
import { useGameSession } from "../../client/realtime/use-game-session";
import { VueJoueur, VueChargement, type ChoixLocal } from "./EcranJoueur";
import { effacerJeton, lireJeton, retourRejoindre, type JetonJoueur } from "./jeton";

interface Props {
  code: string;
}

// Le jeton est lu après le montage : le rendu serveur et la première peinture client sont identiques (squelette).
export default function Jouer({ code }: Props) {
  const [jeton, setJeton] = useState<JetonJoueur | null>(null);
  // Change à chaque restauration depuis le cache de navigation : le remontage rouvre une socket neuve.
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const lu = lireJeton(code);
    if (lu) setJeton(lu);
    else retourRejoindre(code);
  }, [code, generation]);

  useEffect(() => {
    // Une page restaurée par le bfcache garde son état React (boutons en chargement, socket morte).
    const auRetour = (event: PageTransitionEvent) => {
      if (event.persisted) setGeneration((n) => n + 1);
    };
    window.addEventListener("pageshow", auRetour);
    return () => window.removeEventListener("pageshow", auRetour);
  }, []);

  if (!jeton) return <VueChargement code={code} />;
  return <Partie key={generation} code={code} jeton={jeton} />;
}

function Partie({ code, jeton }: { code: string; jeton: JetonJoueur }) {
  const getToken = useCallback(() => jeton.token, [jeton]);
  const { state, answer, next } = useGameSession({ code, getToken });
  const [choixLocal, setChoixLocal] = useState<ChoixLocal | null>(null);
  // Le total de questions n'est pas repris par le message `finished` : on le garde pour l'écran de résultat.
  const total = useRef(0);
  if (state.question) total.current = state.question.total;

  useEffect(() => {
    if (state.connection === "rejected") retourRejoindre(code);
    // Exclu ou partie finie : le jeton ne servira plus, mais l'écran terminal reste affiché (pas de redirection).
    if (state.connection === "kicked" || state.connection === "ended") effacerJeton(code);
  }, [state.connection, code]);

  const repondre = useCallback(
    (questionId: string, optionIds: string[]) => {
      setChoixLocal({ questionId, optionIds });
      answer(questionId, optionIds);
    },
    [answer],
  );

  return <VueJoueur code={code} state={state} total={total.current} choixLocal={choixLocal} onAnswer={repondre} onNext={next} />;
}
