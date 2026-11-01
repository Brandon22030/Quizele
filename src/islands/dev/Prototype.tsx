import { useEffect, useState } from "react";
import { useGameSession } from "../../client/realtime/use-game-session";
import { joinResponseSchema } from "../../shared/protocol";

interface Props {
  code: string;
  role: "host" | "player";
  hostToken?: string;
}

const bouton =
  "min-h-11 rounded-md border-trait border-vert-foret bg-creme px-4 font-affiche text-base text-vert-foret shadow-relief-sm";

const libelleConnexion = {
  connecting: "Connexion en cours...",
  open: "Connecté",
  reconnecting: "Connexion perdue, reprise en cours...",
} as const;

function Partie({ code, role, getToken }: { code: string; role: "host" | "player"; getToken: () => string }) {
  const { state, send, answer } = useGameSession({ code, getToken });
  const [selection, setSelection] = useState<string[]>([]);
  const [restant, setRestant] = useState<number | null>(null);
  const question = state.question;

  useEffect(() => setSelection([]), [question?.questionId]);
  useEffect(() => {
    if (state.phase !== "question" || !state.clock) {
      setRestant(null);
      return;
    }
    const clock = state.clock;
    const timer = setInterval(() => setRestant(Math.ceil(clock.remaining() / 1000)), 200);
    return () => clearInterval(timer);
  }, [state.phase, state.clock]);

  const basculer = (id: string) =>
    setSelection((actuelle) => {
      if (question?.kind !== "multiple") return [id];
      return actuelle.includes(id) ? actuelle.filter((x) => x !== id) : [...actuelle, id];
    });

  return (
    <section className="flex flex-col gap-4">
      <p role="status" className="text-sm text-vert-mousse">
        {libelleConnexion[state.connection]} - {role === "host" ? "animateur" : "joueur"} - partie {code}
      </p>
      {state.error && <p role="alert" className="text-sm text-piment">Erreur : {state.error}</p>}
      {state.phase === null && <p>En attente de l'état de la partie...</p>}
      {state.phase === "lobby" && (
        <div className="flex flex-col gap-3">
          <p>{state.playerCount === 0 ? "Aucun joueur pour l'instant." : `${state.playerCount} joueur(s) dans la salle.`}</p>
          {role === "host" && <button className={bouton} onClick={() => send({ type: "start" })}>Lancer la partie</button>}
        </div>
      )}
      {question && (state.phase === "question" || state.phase === "revealed") && (
        <div className="flex flex-col gap-3">
          <p className="font-affiche text-lg">{question.index + 1} / {question.total} - {question.prompt}</p>
          {restant !== null && <p aria-live="off" className="font-affiche text-xl">{restant} s</p>}
          <ul className="flex flex-col gap-2">
            {question.options.map((option) => {
              const juste = state.reveal?.correctOptionIds?.includes(option.id);
              return (
                <li key={option.id}>
                  <button
                    className={bouton}
                    aria-pressed={selection.includes(option.id)}
                    disabled={role !== "player" || state.answered || state.phase !== "question"}
                    onClick={() => basculer(option.id)}
                  >
                    {option.label}{juste ? " (juste)" : ""}{selection.includes(option.id) ? " *" : ""}
                  </button>
                </li>
              );
            })}
          </ul>
          {role === "player" && state.phase === "question" && (
            <button className={bouton} disabled={state.answered || selection.length === 0} onClick={() => answer(question.questionId, selection)}>
              {state.answered ? "Réponse envoyée" : "Valider"}
            </button>
          )}
          {role === "host" && state.phase === "question" && (
            <>
              <p>{state.answeredCount} / {state.playerCount} réponses</p>
              <button className={bouton} onClick={() => send({ type: "reveal" })}>Révéler</button>
            </>
          )}
          {state.phase === "revealed" && state.reveal?.explanation && <p>{state.reveal.explanation}</p>}
          {state.phase === "revealed" && role === "host" && <button className={bouton} onClick={() => send({ type: "next" })}>Suivant</button>}
        </div>
      )}
      {(state.phase === "revealed" || state.phase === "finished") && (
        <ol className="list-decimal pl-6">
          {(state.phase === "finished" ? state.ranking : (state.reveal?.ranking ?? [])).map((ligne) => (
            <li key={ligne.playerId}>{ligne.pseudo} : {ligne.score}</li>
          ))}
        </ol>
      )}
      {state.phase === "finished" && state.ranking.length === 0 && <p>Partie terminée, aucun joueur au classement.</p>}
    </section>
  );
}

export default function Prototype({ code, role, hostToken }: Props) {
  const [token, setToken] = useState<string | null>(hostToken ?? null);
  const [pseudo, setPseudo] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    if (role === "player") setToken(sessionStorage.getItem(`jeton-${code}`));
  }, [role, code]);

  async function rejoindre(event: { preventDefault(): void }) {
    event.preventDefault();
    setEnvoi(true);
    setErreur(null);
    try {
      const reponse = await fetch(`/api/parties/${code}/joueurs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pseudo }),
      });
      const corps: unknown = await reponse.json();
      const parsed = joinResponseSchema.safeParse(corps);
      if (!reponse.ok || !parsed.success) throw new Error("refus");
      sessionStorage.setItem(`jeton-${code}`, parsed.data.token);
      setToken(parsed.data.token);
    } catch {
      setErreur("Impossible de rejoindre : pseudo invalide, déjà pris, ou partie introuvable.");
    } finally {
      setEnvoi(false);
    }
  }

  if (!token) {
    return (
      <form onSubmit={rejoindre} className="flex flex-col gap-3">
        <label htmlFor="pseudo" className="font-affiche text-lg">Ton pseudo</label>
        <input id="pseudo" value={pseudo} maxLength={20} required onChange={(e) => setPseudo(e.target.value)} className="min-h-11 rounded-md border-trait border-vert-foret bg-creme px-3" />
        {erreur && <p role="alert" className="text-sm text-piment">{erreur}</p>}
        <button className={bouton} disabled={envoi}>{envoi ? "Connexion..." : "Rejoindre"}</button>
      </form>
    );
  }
  return <Partie code={code} role={role} getToken={() => token} />;
}
