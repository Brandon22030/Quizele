import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Eye, ListChecks } from "lucide-react";
import { AnswerList, AnswerTile, Chrono, EnonceQuestion, EnteteQuestion, Explication, ValidationMultiple } from "../../components/jeu";
import { Button } from "../../components/ui/button";
import { EtatErreur } from "../../components/ui/etat-erreur";
import { EtatVide } from "../../components/ui/etat-vide";
import { Papier } from "../../components/ui/papier";
import { Squelette } from "../../components/ui/squelette";
import { createQuestionClock, localNow } from "../../shared/clock";
import { FocusTitre } from "../joueur/FocusTitre";
import { LETTRES, LIBELLE_VIDE, PROMPT_VIDE, estJuste, messageVerdict, urlEditeur, type DonneesApercu, type QuestionApercu } from "./logique";

// Verdict embarque motion : chargé à la demande, comme sur l'écran de jeu.
const Verdict = lazy(() => import("../../components/jeu/Verdict").then((m) => ({ default: m.Verdict })));

// Le thème forêt rend visibles le focus (jaune) et la bordure du bouton sur le fond vert du bandeau.
function Bandeau({ quizId }: { quizId: string }) {
  return (
    <header data-theme="foret" className="sticky top-0 z-40 bg-vert-foret text-creme">
      <div className="mx-auto flex w-full max-w-xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2">
        <Eye aria-hidden="true" className="size-5 shrink-0 text-jaune-soleil" />
        <p className="min-w-0 flex-1 font-extrabold">Aperçu : tes réponses ne comptent pas</p>
        <Button href={urlEditeur(quizId)} variante="soleil" taille="petit">
          Retour à l'éditeur
        </Button>
      </div>
    </header>
  );
}

function Cadre({ quizId, navigation, children }: { quizId: string; navigation?: ReactNode; children: ReactNode }) {
  return (
    <div className="trame-points flex min-h-dvh flex-col bg-jaune-soleil text-vert-foret">
      <Bandeau quizId={quizId} />
      <main className="mx-auto w-full max-w-ecran flex-1 pb-6">{children}</main>
      {navigation}
    </div>
  );
}

export function VueChargement({ quizId }: { quizId: string }) {
  return (
    <Cadre quizId={quizId}>
      <div aria-busy="true" className="px-4 pt-4">
        <h1 className="sr-only">Chargement de l'aperçu</h1>
        <Squelette className="h-10 w-2/3 rounded-pill" />
        <Squelette className="mt-8 h-scene-basse w-full" />
        <Squelette className="mt-8 h-16 w-full" />
        <Squelette className="mt-4 h-16 w-full" />
        <Squelette className="mt-4 h-16 w-full" />
      </div>
    </Cadre>
  );
}

export function VueErreur({ quizId, message, onRetry }: { quizId: string; message: string; onRetry?: () => void }) {
  return (
    <Cadre quizId={quizId}>
      <div className="px-4 pt-6">
        <h1 className="sr-only">Aperçu du quiz</h1>
        <EtatErreur titre="Aperçu indisponible" onRetry={onRetry}>
          {message}
        </EtatErreur>
        <Button href="/tableau-de-bord" variante="creme" taille="petit" className="mt-4">
          Retour à tes quiz
        </Button>
      </div>
    </Cadre>
  );
}

function VueVide({ quizId }: { quizId: string }) {
  return (
    <Cadre quizId={quizId}>
      <h1 className="sr-only">Aperçu du quiz</h1>
      <EtatVide
        icone={<ListChecks className="size-10" />}
        titre="Rien à prévisualiser"
        action={<Button href={urlEditeur(quizId)}>Ajouter une question</Button>}
      >
        Ce quiz n'a pas encore de question. Ajoute-en une dans l'éditeur pour la voir comme tes joueurs.
      </EtatVide>
    </Cadre>
  );
}

export function VueApercu({ donnees }: { donnees: DonneesApercu }) {
  const [index, setIndex] = useState(0);
  // Les barres collantes (bandeau en haut, navigation en bas) ne doivent pas masquer l'élément qui reçoit le focus.
  useEffect(() => {
    const classes = ["scroll-pt-20", "scroll-pb-20"];
    document.documentElement.classList.add(...classes);
    return () => document.documentElement.classList.remove(...classes);
  }, []);
  const total = donnees.questions.length;
  if (total === 0) return <VueVide quizId={donnees.quizId} />;
  const question = donnees.questions[index]!;

  const navigation = (
    <nav aria-label="Navigation dans l'aperçu" className="sticky bottom-0 z-30 border-trait border-x-0 border-b-0 border-vert-foret bg-jaune-soleil">
      <div className="mx-auto flex w-full max-w-ecran gap-3 px-4 py-3">
        <Button variante="creme" taille="petit" className="flex-1" disabled={index === 0} onClick={() => setIndex(index - 1)}>
          <ArrowLeft aria-hidden="true" className="size-4" />
          Précédente
        </Button>
        <Button variante="creme" taille="petit" className="flex-1" disabled={index === total - 1} onClick={() => setIndex(index + 1)}>
          Suivante
          <ArrowRight aria-hidden="true" className="size-4" />
        </Button>
      </div>
    </nav>
  );

  return (
    <Cadre quizId={donnees.quizId} navigation={navigation}>
      <EcranQuestion key={question.id} question={question} index={index} total={total} montrerBonne={donnees.showCorrectAnswer} />
    </Cadre>
  );
}

interface QuestionProps {
  question: QuestionApercu;
  index: number;
  total: number;
  montrerBonne: boolean;
}

// key={question.id} (posée par le parent) remet à zéro l'horloge, la sélection et la correction à chaque question.
function EcranQuestion({ question, index, total, montrerBonne }: QuestionProps) {
  // Aperçu hors partie : pas de Durable Object, donc pas d'heure serveur. Départ et « heure serveur » viennent de la
  // même lecture locale ; c'est la seule exception documentée au chrono serveur.
  const [clock] = useState(() => {
    const maintenant = localNow();
    return createQuestionClock({ startedAt: maintenant, serverNow: maintenant, durationMs: question.durationSec * 1000 });
  });
  const [choix, setChoix] = useState<string[] | null>(null);
  const [selection, setSelection] = useState<string[]>([]);

  const options = question.options.map((option, i) => ({ ...option, lettre: LETTRES[i] ?? "?", index: i, label: option.label || LIBELLE_VIDE }));
  const prompt = question.prompt || PROMPT_VIDE;

  if (choix !== null) {
    return <Correction question={question} prompt={prompt} options={options} choix={choix} index={index} total={total} montrerBonne={montrerBonne} />;
  }

  const toucher = (id: string) => {
    if (question.type === "multiple") setSelection((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    else setChoix([id]);
  };

  return (
    <>
      <FocusTitre selecteur="h1" />
      <EnteteQuestion index={index + 1} total={total} />
      <div className="flex items-center gap-4 px-4 pt-4">
        <Chrono clock={clock} onExpire={() => setChoix(selection)} />
        <p className="-rotate-3 font-note text-xl leading-tight">
          Exactement ce
          <br />
          que verra ta salle.
        </p>
      </div>
      <EnonceQuestion prompt={prompt} kind={question.type} />
      <AnswerList label="Réponses">
        {options.map((o) => (
          <AnswerTile
            key={o.id}
            index={o.index}
            letter={o.lettre}
            label={o.label}
            state={selection.includes(o.id) ? "choisie" : "repos"}
            onSelect={() => toucher(o.id)}
          />
        ))}
      </AnswerList>
      {question.type === "multiple" ? (
        <div className="px-4">
          <ValidationMultiple selectedCount={selection.length} onValidate={() => setChoix(selection)} />
        </div>
      ) : null}
    </>
  );
}

interface CorrectionProps extends QuestionProps {
  prompt: string;
  options: Array<{ id: string; label: string; isCorrect: boolean; lettre: string; index: number }>;
  choix: string[];
}

function Correction({ question, prompt, options, choix, index, total, montrerBonne }: CorrectionProps) {
  const juste = estJuste(question, choix);
  const message = messageVerdict(juste, choix);
  const tuiles = options.filter((o) => o.isCorrect || choix.includes(o.id));

  return (
    <>
      <EnteteQuestion index={index + 1} total={total} />
      <h1 className="sr-only">{prompt}</h1>
      <Suspense fallback={<VerdictStatique correct={juste} message={message} />}>
        <Verdict correct={juste} message={message} />
        {/* Monté avec le vrai verdict seulement : le titre de secours serait remplacé et le focus perdu. */}
        <FocusTitre selecteur='[role="heading"][aria-level="2"]' />
      </Suspense>
      <div className="flex flex-col gap-4 px-4 pt-6">
        {tuiles.map((o) => (
          <AnswerTile key={o.id} index={o.index} letter={o.lettre} label={o.label} state={o.isCorrect ? "juste" : "taReponse"} />
        ))}
        <Explication explanation={question.explanation ?? undefined} reference={question.reference ?? undefined} />
        {montrerBonne ? null : (
          <Papier className="my-0 px-4 py-4">
            <p className="font-bold">
              Dans la vraie partie, la bonne réponse reste masquée : le réglage « Montrer la bonne réponse » est désactivé.
            </p>
          </Papier>
        )}
      </div>
    </>
  );
}

function VerdictStatique({ correct, message }: { correct: boolean; message: string }) {
  return (
    <section aria-label="Verdict" className="px-6 pt-8 text-center">
      <p role="heading" aria-level={2} className="font-badge text-4xl tracking-wider">
        {correct ? "JUSTE !" : "PAS CETTE FOIS !"}
      </p>
      <p className="mt-4 font-affiche text-xl">{message}</p>
    </section>
  );
}
