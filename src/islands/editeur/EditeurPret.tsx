import { useCallback, useEffect, useState, useSyncExternalStore, type MouseEvent } from "react";
import { ChevronLeft, Eye, List, Play, Plus, SlidersHorizontal } from "lucide-react";
import { Button } from "../../components/ui/button";
import { EtatVide } from "../../components/ui/etat-vide";
import { Feuille } from "../../components/ui/feuille";
import { Modal } from "../../components/ui/modal";
import { Papier } from "../../components/ui/papier";
import { TITLE_MAX } from "../../shared/quiz-schema";
import { ApercuJoueur } from "./ApercuJoueur";
import { FormulaireQuestion } from "./FormulaireQuestion";
import { LienIcone } from "./LienIcone";
import { ListeQuestions } from "./ListeQuestions";
import { NavQuestions } from "./NavQuestions";
import { MessageEnregistrement, StatutEnregistrement } from "./StatutEnregistrement";
import type { FileEnregistrement } from "./file-enregistrement";
import {
  aDesMarques,
  ajouterQuestion,
  changerTitre,
  dupliquerQuestion,
  nouvelleQuestion,
  ordonner,
  peutAjouterQuestion,
  statutQuiz,
  supprimerQuestion,
  type Brouillon,
} from "./modele";

interface Props {
  file: FileEnregistrement;
  question?: number;
}

export function EditeurPret({ file, question }: Props) {
  const { brouillon: b, statut, message, code } = useSyncExternalStore(file.abonner, file.instantane, file.instantane);
  const [disposition, setDisposition] = useState<"creation" | "edition">(b.quizId === null && b.questions.length <= 1 ? "creation" : "edition");
  const [courante, setCourante] = useState<string | null>(() => b.questions[(question ?? 1) - 1]?.key ?? b.questions[0]?.key ?? null);
  const [feuille, setFeuille] = useState(false);
  const [aSupprimer, setASupprimer] = useState<string | null>(null);

  const modifier = useCallback((fn: (b: Brouillon) => Brouillon) => file.modifier(fn), [file]);

  // Retour du réseau, page masquée ou fermée : on envoie sans attendre le délai. localStorage garde tout si l'envoi n'aboutit pas.
  useEffect(() => {
    const enAttente = () => aDesMarques(file.instantane().brouillon);
    const relancer = () => {
      if (enAttente()) void file.relancer();
    };
    const vider = () => {
      if (enAttente()) void file.vider();
    };
    const masquee = () => {
      if (document.visibilityState === "hidden") vider();
    };
    window.addEventListener("online", relancer);
    window.addEventListener("pagehide", vider);
    document.addEventListener("visibilitychange", masquee);
    return () => {
      window.removeEventListener("online", relancer);
      window.removeEventListener("pagehide", vider);
      document.removeEventListener("visibilitychange", masquee);
    };
  }, [file]);

  const index = Math.max(0, b.questions.findIndex((q) => q.key === courante));
  const q = b.questions[index] ?? null;
  const total = b.questions.length;
  const statutDuQuiz = statutQuiz(b);
  const peutAjouter = peutAjouterQuestion(b);
  const retour = typeof window === "undefined" ? "/tableau-de-bord" : window.location.pathname;

  function ajouter() {
    if (!peutAjouter) return;
    const nouvelle = nouvelleQuestion();
    modifier((courant) => ajouterQuestion(courant, nouvelle));
    setCourante(nouvelle.key);
    setDisposition("edition");
    setFeuille(false);
  }

  function dupliquer() {
    if (!q || !peutAjouter) return;
    const avant = new Set(b.questions.map((x) => x.key));
    modifier((courant) => dupliquerQuestion(courant, q.key));
    const copie = file.instantane().brouillon.questions.find((x) => !avant.has(x.key));
    if (copie) setCourante(copie.key);
  }

  function supprimer(key: string) {
    const position = b.questions.findIndex((x) => x.key === key);
    const voisine = b.questions[position + 1] ?? b.questions[position - 1];
    modifier((courant) => supprimerQuestion(courant, key));
    setCourante(voisine?.key ?? null);
    setASupprimer(null);
  }

  // Un lien vers une autre page attend l'enregistrement : l'aperçu et le lancement lisent le quiz côté serveur.
  async function naviguer(e: MouseEvent<HTMLAnchorElement>, href: string) {
    if (!aDesMarques(file.instantane().brouillon)) return;
    e.preventDefault();
    const ok = await file.vider();
    if (ok && !aDesMarques(file.instantane().brouillon)) window.location.assign(href);
  }

  const quizId = b.quizId;
  const urlApercu = quizId ? `/quiz/${quizId}/apercu` : null;
  const urlLancer = quizId ? `/quiz/${quizId}/lancer` : null;
  const creation = disposition === "creation";
  const lancerActif = quizId !== null && (creation ? statut === "enregistre" && statutDuQuiz.ready : true);

  const lien = (href: string | null, actif: boolean, variante: "primaire" | "creme", libelle: string, icone: React.ReactNode, taille: "normal" | "petit" = "normal", className?: string) =>
    href && actif ? (
      <Button href={href} variante={variante} taille={taille} className={className} onClick={(e) => void naviguer(e, href)}>
        {icone}
        {libelle}
      </Button>
    ) : (
      <Button variante={variante} taille={taille} className={className} disabled>
        {icone}
        {libelle}
      </Button>
    );

  const icone = (Icone: typeof Play) => <Icone aria-hidden="true" className="size-5" />;

  return (
    <div className="trame-points flex min-h-dvh flex-col bg-jaune-soleil text-vert-foret lg:h-dvh">
      <header className="flex min-h-16 items-center gap-3 px-4 py-2 lg:border-trait lg:border-x-0 lg:border-t-0 lg:border-vert-foret lg:px-8 lg:py-3">
        <LienIcone href="/tableau-de-bord" label="Retour au tableau de bord" icone={<ChevronLeft aria-hidden="true" className="size-6" />} />
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1 lg:flex-row lg:items-center lg:gap-3">
          {creation ? (
            <h1 className="font-affiche text-lg leading-tight">Nouveau quiz</h1>
          ) : (
            <>
              <h1 className="sr-only">Éditeur de quiz</h1>
              <input
                aria-label="Titre du quiz"
                value={b.title}
                maxLength={TITLE_MAX}
                placeholder="Titre du quiz"
                onChange={(e) => modifier((courant) => changerTitre(courant, e.target.value))}
                className="min-h-11 w-full min-w-0 rounded-sm bg-transparent font-affiche text-lg leading-tight text-vert-foret placeholder:text-vert-mousse lg:w-auto lg:flex-none lg:text-xl"
              />
            </>
          )}
          <StatutEnregistrement statut={statut} />
        </div>
        {quizId ? (
          <>
            <LienIcone
              href={`/quiz/${quizId}/reglages`}
              label="Réglages du quiz"
              icone={<SlidersHorizontal aria-hidden="true" className="size-5" />}
              className="lg:hidden"
            />
            <div className="hidden gap-3 lg:flex">
              <Button href={`/quiz/${quizId}/reglages`} variante="creme" taille="petit">
                {icone(SlidersHorizontal)}
                Réglages
              </Button>
              {lien(urlLancer, lancerActif, "primaire", "Lancer", icone(Play), "petit")}
            </div>
          </>
        ) : null}
      </header>

      <MessageEnregistrement statut={statut} message={message} code={code} retour={retour} onRetry={() => void file.relancer()} />

      {creation && q ? (
        <div className="flex flex-1 flex-col gap-8 pb-4">
          <div className="px-4 pt-4">
            <label htmlFor="titre-quiz" className="text-sm font-extrabold">
              Titre du quiz
            </label>
            <input
              id="titre-quiz"
              value={b.title}
              maxLength={TITLE_MAX}
              onChange={(e) => modifier((courant) => changerTitre(courant, e.target.value))}
              className="mt-2 min-h-14 w-full rounded-md border-trait border-vert-foret bg-creme px-4 font-affiche text-xl text-vert-foret shadow-relief-sm"
            />
          </div>
          <Papier className="mx-4 px-4 py-5">
            <FormulaireQuestion question={q} numero={1} modifier={modifier} variante="creation" />
          </Papier>
          <p className="-rotate-2 px-6 text-center font-note text-xl">Pas de réglage à faire avant : on s'en occupe plus tard.</p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-4">
          <aside aria-label="Liste des questions" className="hidden min-h-0 flex-col gap-3 overflow-y-auto border-trait border-y-0 border-l-0 border-vert-foret p-5 lg:flex">
            <p className="font-affiche text-lg">Questions ({total})</p>
            <ListeQuestions questions={b.questions} courante={q?.key ?? null} onSelect={setCourante} onOrdre={(cles) => modifier((courant) => ordonner(courant, cles))} onAjouter={ajouter} peutAjouter={peutAjouter} />
          </aside>

          <section aria-label="Question" className="flex min-h-0 flex-1 flex-col gap-1 lg:col-span-2 lg:overflow-y-auto lg:px-8 lg:py-6">
            {q ? (
              <>
                <div className="flex items-center gap-2 lg:hidden">
                  <div className="min-w-0 flex-1">
                    <NavQuestions questions={b.questions} courante={q.key} onSelect={setCourante} onAjouter={ajouter} peutAjouter={peutAjouter} />
                  </div>
                  <button
                    type="button"
                    onClick={() => setFeuille(true)}
                    aria-label="Voir et réorganiser les questions"
                    className="mr-4 grid size-11 shrink-0 place-items-center rounded-sm border-trait border-vert-foret bg-creme text-vert-foret"
                  >
                    <List aria-hidden="true" className="size-5" />
                  </button>
                </div>
                <div className="px-4 pb-6 lg:px-0">
                  <FormulaireQuestion
                    key={q.key}
                    question={q}
                    numero={index + 1}
                    modifier={modifier}
                    variante="edition"
                    onDupliquer={peutAjouter ? dupliquer : undefined}
                    onSupprimer={() => setASupprimer(q.key)}
                  />
                </div>
              </>
            ) : (
              <EtatVide
                icone={<Plus className="size-10" />}
                titre="Ce quiz n'a pas encore de question"
                action={
                  <Button bloc onClick={ajouter}>
                    <Plus aria-hidden="true" className="size-5" />
                    Créer la question 1
                  </Button>
                }
              >
                Commence par la première : un énoncé et deux réponses suffisent.
              </EtatVide>
            )}
          </section>

          <aside
            data-theme="foret"
            aria-label="Aperçu joueur"
            className="hidden min-h-0 flex-col items-center gap-3 overflow-y-auto border-trait border-y-0 border-r-0 border-vert-nuit bg-vert-foret p-5 text-creme lg:flex"
          >
            <p className="flex items-center gap-2 self-start font-affiche text-lg text-jaune-soleil">
              <Eye aria-hidden="true" className="size-5" />
              Ce que voit le joueur
            </p>
            {q ? <ApercuJoueur question={q} numero={index + 1} total={total} /> : null}
            {urlApercu ? (
              <Button href={urlApercu} variante="soleil" taille="petit" onClick={(e) => void naviguer(e, urlApercu)}>
                {icone(Eye)}
                Essayer en plein écran
              </Button>
            ) : null}
          </aside>
        </div>
      )}

      <div className="sticky bottom-0 flex gap-3 border-trait border-x-0 border-b-0 border-vert-foret bg-jaune-soleil px-4 pt-3 pb-5 lg:hidden">
        {creation ? (
          <Button variante="creme" className="flex-1" onClick={ajouter} disabled={!peutAjouter}>
            {icone(Plus)}
            Question
          </Button>
        ) : (
          lien(urlApercu, quizId !== null, "creme", "Aperçu", icone(Eye), "normal", "flex-1")
        )}
        {lien(urlLancer, lancerActif, "primaire", "Lancer", icone(Play), "normal", "flex-1")}
      </div>

      <Feuille open={feuille} onClose={() => setFeuille(false)} titre={`Tes questions (${total})`}>
        <ListeQuestions
          enFeuille
          questions={b.questions}
          courante={q?.key ?? null}
          onSelect={(key) => {
            setCourante(key);
            setFeuille(false);
          }}
          onOrdre={(cles) => modifier((courant) => ordonner(courant, cles))}
          onAjouter={ajouter}
          peutAjouter={peutAjouter}
        />
      </Feuille>

      <Modal open={aSupprimer !== null} onClose={() => setASupprimer(null)} titre="Supprimer cette question ?">
        <p className="text-base font-bold">La question et ses réponses seront supprimées. Cette action est définitive.</p>
        <div className="flex gap-3">
          <Button variante="creme" taille="petit" className="flex-1" onClick={() => setASupprimer(null)}>
            Annuler
          </Button>
          <Button taille="petit" className="flex-1" onClick={() => aSupprimer && supprimer(aSupprimer)}>
            Supprimer
          </Button>
        </div>
      </Modal>
    </div>
  );
}
