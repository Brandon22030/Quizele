import { useEffect, useMemo, useState } from "react";
import { Users } from "lucide-react";
import {
  AnswerList,
  AnswerTile,
  AttenteAnimateur,
  AttenteQuestionSuivante,
  Chrono,
  Classement,
  CodeCases,
  EcranJeu,
  EnonceQuestion,
  EnteteQuestion,
  Explication,
  Jauge,
  ListeJoueurs,
  Podium,
  PuceJoueur,
  ReponseEnregistree,
  ScoreFinal,
  StatutConnexion,
  ValidationMultiple,
} from "../index";
import { Verdict } from "../Verdict";
import { Button } from "../../ui/button";
import { Papier } from "../../ui/papier";
import { Pilule } from "../../ui/pilule";
import { createQuestionClock, localNow, type QuestionClock } from "../../../shared/clock";

const joueurs = [
  { id: "1", pseudo: "Esther.B" },
  { id: "2", pseudo: "Grâce_22" },
  { id: "3", pseudo: "David" },
  { id: "4", pseudo: "Ruth" },
  { id: "5", pseudo: "Josué777" },
  { id: "6", pseudo: "Marie-Ange" },
  { id: "7", pseudo: "Élodie" },
  { id: "8", pseudo: "Paul" },
  { id: "9", pseudo: "Léa" },
];

// Horloge figée : le styleguide montre un état précis, pas un compte à rebours qui fuit pendant la capture.
// `now` est une fonction stable (valeur constante) : la dérive vaut 0 et le reste ne bouge pas.
function Fige({ restantMs, durationMs = 20_000 }: { restantMs: number; durationMs?: number }) {
  const clock = useMemo(() => {
    const base = 1_000_000;
    const maintenant = base + (durationMs - restantMs);
    return createQuestionClock({ startedAt: base, serverNow: maintenant, durationMs }, () => maintenant);
  }, [restantMs, durationMs]);
  return <Chrono clock={clock} />;
}

function Cadre({ id, titre, children }: { id: string; titre: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-label={titre} className="mx-auto w-full max-w-ecran border-b-4 border-dashed border-vert-foret">
      <h2 className="px-4 pt-6 pb-2 font-affiche text-xl">{titre}</h2>
      {children}
    </section>
  );
}

const nouvelleHorloge = (): QuestionClock => {
  const maintenant = localNow();
  return createQuestionClock({ startedAt: maintenant, serverNow: maintenant, durationMs: 12_000 }, localNow);
};

function ChronoLive() {
  // Créée après montage : l'heure locale du serveur de rendu ne doit pas se retrouver dans le HTML hydraté.
  const [clock, setClock] = useState<QuestionClock | null>(null);
  const [ecoule, setEcoule] = useState(false);
  useEffect(() => setClock(nouvelleHorloge()), []);
  const relancer = () => {
    setEcoule(false);
    setClock(nouvelleHorloge());
  };
  return (
    <div className="flex items-center gap-4 px-4">
      {clock ? <Chrono clock={clock} onExpire={() => setEcoule(true)} /> : <div className="size-chrono flex-none" />}
      <div className="flex flex-col items-start gap-2">
        <p className="font-note text-xl">Chrono en direct : 12 s, tremble sous 5 s.</p>
        {ecoule ? (
          <Button taille="petit" variante="soleil" onClick={relancer}>
            Relancer le chrono
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Question() {
  const [choix, setChoix] = useState<string | null>("b");
  const options = ["Abraham", "Noé", "Moïse", "Élie"];
  return (
    <EcranJeu>
      <EnteteQuestion index={3} total={10} score={2} />
      <div className="flex items-center gap-4 px-4 pt-4">
        <Fige restantMs={12_000} />
        <p className="-rotate-3 font-note text-xl leading-tight">
          Choisis vite,
          <br />
          le chrono tourne !
        </p>
      </div>
      <EnonceQuestion prompt="Qui a construit l'arche pour échapper au déluge ?" kind="single" />
      <AnswerList label="Réponses">
        {options.map((label, i) => {
          const id = "abcd"[i]!;
          return <AnswerTile key={id} index={i} letter={id.toUpperCase()} label={label} state={choix === id ? "choisie" : "repos"} onSelect={() => setChoix(id)} />;
        })}
      </AnswerList>
    </EcranJeu>
  );
}

function Multiple() {
  const [sel, setSel] = useState<string[]>([]);
  const options = ["Matthieu", "Marc", "Judas", "Luc"];
  return (
    <EcranJeu>
      <EnteteQuestion index={4} total={10} score={3} />
      <div className="flex items-center gap-4 px-4 pt-4">
        <Fige restantMs={8_000} />
      </div>
      <EnonceQuestion prompt="Lesquels sont auteurs d'un Évangile ?" kind="multiple" />
      <AnswerList label="Réponses">
        {options.map((label, i) => {
          const id = "abcd"[i]!;
          return (
            <AnswerTile
              key={id}
              index={i}
              letter={id.toUpperCase()}
              label={label}
              state={sel.includes(id) ? "choisie" : "repos"}
              onSelect={() => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}
            />
          );
        })}
      </AnswerList>
      <div className="px-4">
        <ValidationMultiple selectedCount={sel.length} onValidate={() => undefined} />
      </div>
    </EcranJeu>
  );
}

export default function StyleguideJeu() {
  const [code, setCode] = useState("K7Q2M");
  return (
    <div className="bg-jaune-soleil">
      <Cadre id="chrono" titre="Chrono : calme, attention, critique, écoulé">
        <div className="grid grid-cols-2 gap-4 p-4">
          <Fige restantMs={14_000} />
          <Fige restantMs={9_000} />
          <Fige restantMs={3_000} />
          <Fige restantMs={0} />
        </div>
        <ChronoLive />
        <div className="h-4" />
      </Cadre>

      <Cadre id="code" titre="CodeCases (focus jaune, collage)">
        <Papier className="mx-4 my-6 px-4 py-6">
          <p id="code-libelle" className="mb-3 text-center text-sm font-extrabold text-vert-mousse">Code de la partie</p>
          <CodeCases labelledBy="code-libelle" value={code} onChange={setCode} />
          <p className="mt-3 text-center text-sm font-semibold text-vert-mousse">Tu peux aussi coller le code entier.</p>
        </Papier>
      </Cadre>

      <Cadre id="tuiles" titre="AnswerTile : tous les états">
        <AnswerList label="États des tuiles" className="pt-4">
          <AnswerTile letter="A" label="Repos" onSelect={() => undefined} />
          <AnswerTile letter="B" index={1} label="Choisie" state="choisie" onSelect={() => undefined} />
          <AnswerTile letter="C" label="Juste" state="juste" />
          <AnswerTile letter="D" label="Ta réponse" state="taReponse" />
          <AnswerTile letter="A" label="Désactivée" state="desactivee" onSelect={() => undefined} />
        </AnswerList>
      </Cadre>

      <Cadre id="ecran-c" titre="c. Salle d'attente">
        <EcranJeu>
          <header className="flex items-center justify-between px-4 pt-2">
            <Pilule variante="foret">Les héros de la foi</Pilule>
            <Pilule variante="creme">Grâce_22</Pilule>
          </header>
          <AttenteAnimateur className="mt-4" />
          <p className="px-6 pt-4 text-center font-bold">C'est bon, tu es dans la partie. L'animateur lancera les questions.</p>
          <Papier className="mx-4 mt-8 px-4 py-5">
            <div className="flex items-center justify-between">
              <h2 className="font-affiche text-xl">Joueurs</h2>
              <Pilule variante="foret"><Users aria-hidden="true" className="size-5" />12</Pilule>
            </div>
            <div className="mt-4">
              <ListeJoueurs players={joueurs} newestId="1" max={6} />
            </div>
          </Papier>
          <p className="mt-8 -rotate-2 text-center font-note text-xl">Prépare ta Bible et ton meilleur sourire !</p>
        </EcranJeu>
      </Cadre>

      <Cadre id="ecran-d" titre="d. Question (unique)">
        <Question />
      </Cadre>

      <Cadre id="ecran-d2" titre="d. Question (plusieurs bonnes réponses)">
        <Multiple />
      </Cadre>

      <Cadre id="ecran-e1" titre="e. Correction juste">
        <EcranJeu>
          <Verdict correct message="+1 bonne réponse. Bien joué, Grâce !" />
          <div className="flex flex-col gap-4 px-4 pt-6">
            <AnswerTile letter="B" label="Noé" state="juste" />
            <Explication explanation="Dieu demande à Noé de construire une arche en bois de gopher pour sauver sa famille et les animaux." reference="Genèse 6:14-22" />
            <Button bloc className="mt-4">
              Continuer
            </Button>
          </div>
        </EcranJeu>
      </Cadre>

      <Cadre id="ecran-e2" titre="e. Correction : pas cette fois">
        <EcranJeu>
          <Verdict correct={false} message="Pas de panique, tu retiens la bonne pour la prochaine." />
          <div className="flex flex-col gap-4 px-4 pt-6">
            <AnswerTile letter="C" label="Moïse" state="taReponse" />
            <AnswerTile letter="B" label="Noé" state="juste" />
            <Explication explanation="Moïse a conduit le peuple hors d'Égypte. L'arche, c'est Noé, bien avant lui." reference="Genèse 6:14-22" />
            <AttenteQuestionSuivante />
          </div>
        </EcranJeu>
      </Cadre>

      <Cadre id="masquee" titre="Correction masquée : aucun indice">
        <EcranJeu>
          <EnteteQuestion index={3} total={10} />
          <div className="px-4 pt-6">
            <AnswerList label="Ta réponse" className="pt-0">
              <AnswerTile letter="B" label="Noé" state="choisie" onSelect={() => undefined} />
            </AnswerList>
            <ReponseEnregistree />
          </div>
        </EcranJeu>
      </Cadre>

      <Cadre id="ecran-f" titre="f. Résultat final">
        <EcranJeu>
          <ScoreFinal score={7} total={10} totalMs={252_000} rank={3} playerCount={24} message="Beau parcours, tu connais bien ta Bible !" />
          <Podium
            className="px-4 pt-8"
            places={[
              { playerId: "3", rank: 2, pseudo: "David" },
              { playerId: "1", rank: 1, pseudo: "Esther.B" },
              { playerId: "2", rank: 3, pseudo: "Grâce_22", isYou: true },
            ]}
          />
          <Classement
            className="mx-4 mt-6"
            total={10}
            rows={[
              { playerId: "4", rank: 4, pseudo: "Ruth", score: 6 },
              { playerId: "5", rank: 5, pseudo: "Josué777", score: 6 },
              { playerId: "6", rank: 6, pseudo: "Marie-Ange", score: 5 },
            ]}
          />
          <div className="px-4 pt-8">
            <Button bloc>Partager mon score</Button>
          </div>
        </EcranJeu>
      </Cadre>

      <Cadre id="vide" titre="Classement vide">
        <EcranJeu className="pb-0">
          <Classement className="mx-4" total={10} rows={[]} />
        </EcranJeu>
      </Cadre>

      <Cadre id="puces" titre="PuceJoueur : arrivée">
        <div className="flex gap-2 p-4">
          <PuceJoueur pseudo="Nouvelle" nouveau />
          <PuceJoueur pseudo="Ancienne" />
        </div>
      </Cadre>

      <section id="foret" aria-label="Fond forêt" className="mx-auto w-full max-w-ecran bg-vert-foret p-4 text-creme">
        <h2 className="font-affiche text-xl text-jaune-soleil">Jauge de réponses (fond forêt)</h2>
        <p className="mt-2 text-sm font-bold">7 réponses sur 12</p>
        <Jauge className="mt-2" value={7} max={12} label="Réponses reçues" />
      </section>

      <Cadre id="statuts" titre="Statuts du temps réel">
        <div className="flex flex-col gap-6 py-4">
          <StatutConnexion status="connecting" />
          <StatutConnexion status="reconnecting" />
          <StatutConnexion status="kicked" rejoindreHref="/" classNameTerminal="pt-0" />
          <StatutConnexion status="ended" rejoindreHref="/" classNameTerminal="pt-0" />
          <StatutConnexion status="rejected" rejoindreHref="/" classNameTerminal="pt-0" />
        </div>
      </Cadre>
    </div>
  );
}
