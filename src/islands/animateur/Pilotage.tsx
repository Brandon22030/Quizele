import { useCallback, useEffect, useRef, useState } from "react";
import { actions } from "astro:actions";
import { useGameSession } from "../../client/realtime/use-game-session";
import { Projection } from "./Projection";
import { ChargementPilotage, EchecPilotage, VuePilotage } from "./VuePilotage";
import { echecDepuisCode, lireJetonHote, oublierJetonHote, type EchecAcces, type JetonHote } from "./logique";
import { memoriserHote } from "../tableau-de-bord/logique";

interface Props {
  sessionId: string;
}

type Acces = { etat: "recherche" } | ({ etat: "pret"; source: "stockage" | "action" } & JetonHote) | { etat: "echec"; echec: EchecAcces };

function stockageSession(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

// Le jeton hôte arrive par sessionStorage (passage du tableau de bord ou du lancement, rechargement du même onglet) ou, à défaut, par l'action jetonHote :
// il ne figure jamais dans l'URL, ni dans le HTML rendu par le serveur, ni dans une trace.
export default function Pilotage({ sessionId }: Props) {
  const [acces, setAcces] = useState<Acces>({ etat: "recherche" });
  const [essai, setEssai] = useState(0);
  const ignorerStockage = useRef(false);

  useEffect(() => {
    let annule = false;
    const stocke = ignorerStockage.current ? null : lireJetonHote(stockageSession(), sessionId);
    ignorerStockage.current = true;
    if (stocke) {
      setAcces({ etat: "pret", source: "stockage", ...stocke });
      return;
    }
    setAcces({ etat: "recherche" });
    actions.partie
      .jetonHote({ sessionId })
      .then(({ data, error }) => {
        if (annule) return;
        if (error) {
          setAcces({ etat: "echec", echec: echecDepuisCode(error.code) });
          return;
        }
        // Un rechargement du même onglet reprend ainsi sans nouvel appel serveur.
        memoriserHote(stockageSession(), {
          sessionId,
          code: data.code,
          hostToken: data.token,
        });
        setAcces({ etat: "pret", source: "action", ...data });
      })
      .catch(() => !annule && setAcces({ etat: "echec", echec: "reseau" }));
    return () => {
      annule = true;
    };
  }, [sessionId, essai]);

  // Jeton refusé par la socket : celui du stockage a pu vieillir, on en redemande un. Un jeton tout neuf refusé à son tour
  // veut dire que la session est périmée : on le dit plutôt que de boucler.
  const surRejet = useCallback(
    (source: "stockage" | "action") => {
      oublierJetonHote(stockageSession(), sessionId);
      if (source === "stockage") {
        // Sans cela, le jeton refusé resterait affiché le temps du nouvel essai et rouvrirait une socket avec lui.
        setAcces({ etat: "recherche" });
        setEssai((n) => n + 1);
      } else setAcces({ etat: "echec", echec: "expire" });
    },
    [sessionId],
  );

  if (acces.etat === "recherche") return <ChargementPilotage />;
  if (acces.etat === "echec") {
    return (
      <EchecPilotage
        echec={acces.echec}
        sessionId={sessionId}
        onReessayer={() => {
          setEssai((n) => n + 1);
        }}
      />
    );
  }
  return <PartieHote key={`${essai}-${acces.token}`} sessionId={sessionId} code={acces.code} token={acces.token} source={acces.source} onRejet={surRejet} />;
}

interface PartieProps {
  sessionId: string;
  code: string;
  token: string;
  source: "stockage" | "action";
  onRejet: (source: "stockage" | "action") => void;
}

function PartieHote({ sessionId, code, token, source, onRejet }: PartieProps) {
  const getToken = useCallback(() => token, [token]);
  const { state, start, reveal, next, end, kick } = useGameSession({
    code,
    getToken,
  });
  const [projection, setProjection] = useState(false);

  useEffect(() => {
    if (state.connection === "rejected") onRejet(source);
  }, [state.connection, source, onRejet]);

  useEffect(() => {
    if (state.phase === "finished" || state.connection === "ended") oublierJetonHote(stockageSession(), sessionId);
  }, [state.phase, state.connection, sessionId]);

  const fermerProjection = useCallback(() => {
    setProjection(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    // Le bouton Projeter reprend le focus : la projection recouvrait la page, le focus ne doit pas tomber sur body.
    // Si la partie a fini pendant la projection, ce bouton n'existe plus : le titre de la page prend le relais.
    requestAnimationFrame(() => (document.getElementById("bouton-projeter") ?? document.querySelector<HTMLElement>("[data-focus-titre]"))?.focus());
  }, []);

  useEffect(() => {
    if (!projection) return;
    let entreEnPleinEcran = Boolean(document.fullscreenElement);
    // Échap quitte le plein écran sans passer par l'application : la vue agrandie se referme avec lui.
    const surPleinEcran = () => {
      if (document.fullscreenElement) entreEnPleinEcran = true;
      else if (entreEnPleinEcran) fermerProjection();
    };
    // Repli sans plein écran (API refusée ou absente) : Échap ferme la vue agrandie.
    const surTouche = (event: KeyboardEvent) => {
      if (event.key === "Escape") fermerProjection();
    };
    document.addEventListener("fullscreenchange", surPleinEcran);
    document.addEventListener("keydown", surTouche);
    return () => {
      document.removeEventListener("fullscreenchange", surPleinEcran);
      document.removeEventListener("keydown", surTouche);
    };
  }, [projection, fermerProjection]);

  const projeter = useCallback(() => {
    setProjection(true);
    // Appelée dans le geste du clic, seul moment où le navigateur accepte le plein écran. Un refus laisse la vue agrandie.
    const demande = document.documentElement.requestFullscreen?.();
    void demande?.catch(() => undefined);
  }, []);

  return (
    <>
      <div inert={projection}>
        <VuePilotage
          sessionId={sessionId}
          code={code}
          state={state}
          onDemarrer={start}
          onReveler={reveal}
          onSuivante={next}
          onTerminer={end}
          onRetirer={kick}
          onProjeter={projeter}
          projectionOuverte={projection}
        />
      </div>
      {projection ? <Projection sessionId={sessionId} onFermer={fermerProjection} /> : null}
    </>
  );
}
