import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { GripVertical, Plus } from "lucide-react";
import { buttonClasses } from "../../components/ui/button";
import { cn } from "../../components/ui/cn";
import { AIDE_LIMITE_QUESTIONS, estComplete, libelleQuestion, problemeQuestion, type QuestionBrouillon } from "./modele";
import { annonceDeplacement, decalerCle, deplacer, indexSousPointeur, vitesseDefilement } from "./ordre";

interface Props {
  questions: readonly QuestionBrouillon[];
  courante: string | null;
  onSelect: (key: string) => void;
  onOrdre: (cles: string[]) => void;
  onAjouter: () => void;
  peutAjouter: boolean;
  // Dans la feuille mobile, l'ajout est l'action principale ; dans la colonne de bureau, un bouton discret en pointillés.
  enFeuille?: boolean;
}

// Liste réordonnable, utilisée dans la feuille « Tes questions » (mobile) et dans la colonne de gauche (bureau). Deux façons de
// déplacer : glisser la poignée (souris, doigt) ou, poignée au focus, flèches haut et bas.
export function ListeQuestions({ questions, courante, onSelect, onOrdre, onAjouter, peutAjouter, enFeuille = false }: Props) {
  const aideId = useId();
  const limiteId = useId();
  const listeRef = useRef<HTMLOListElement>(null);
  const lignes = useRef(new Map<string, HTMLLIElement>());
  const poignees = useRef(new Map<string, HTMLButtonElement>());
  const aRefocaliser = useRef<string | null>(null);
  const [glisse, setGlisse] = useState<string | null>(null);
  const [annonce, setAnnonce] = useState("");
  const cles = questions.map((q) => q.key);
  const clesRef = useRef(cles);
  clesRef.current = cles;

  // Un nœud déplacé par React perd le focus : on le rend à la poignée après chaque déplacement au clavier.
  useLayoutEffect(() => {
    if (aRefocaliser.current) {
      poignees.current.get(aRefocaliser.current)?.focus();
      aRefocaliser.current = null;
    }
  });

  useEffect(() => {
    if (!glisse) return;
    const zone = zoneDefilante(listeRef.current);
    let y: number | null = null;
    let image = 0;
    const placer = () => {
      if (y === null) return;
      const courant = clesRef.current;
      const bandes = courant.map((k) => {
        const r = lignes.current.get(k)?.getBoundingClientRect();
        return { top: r?.top ?? 0, bottom: r?.bottom ?? 0 };
      });
      const cible = indexSousPointeur(bandes, y);
      const depart = courant.indexOf(glisse);
      if (cible !== -1 && depart !== -1 && cible !== depart) onOrdre(deplacer(courant, depart, cible));
    };
    // Tant que le pointeur reste près d'un bord, la zone défile à chaque image ; les lignes passent sous le pointeur immobile.
    const defiler = () => {
      image = 0;
      if (y === null || !zone) return;
      const { top, bottom } = zone === document.scrollingElement ? { top: 0, bottom: window.innerHeight } : zone.getBoundingClientRect();
      const vitesse = vitesseDefilement(y, top, bottom);
      if (vitesse === 0) return;
      const avant = zone.scrollTop;
      zone.scrollTop += vitesse;
      if (zone.scrollTop === avant) return;
      placer();
      image = requestAnimationFrame(defiler);
    };
    const suivre = (e: globalThis.PointerEvent) => {
      y = e.clientY;
      placer();
      if (!image) image = requestAnimationFrame(defiler);
    };
    const finir = () => setGlisse(null);
    window.addEventListener("pointermove", suivre);
    window.addEventListener("pointerup", finir);
    window.addEventListener("pointercancel", finir);
    return () => {
      cancelAnimationFrame(image);
      window.removeEventListener("pointermove", suivre);
      window.removeEventListener("pointerup", finir);
      window.removeEventListener("pointercancel", finir);
    };
  }, [glisse, onOrdre]);

  function auClavier(e: KeyboardEvent<HTMLButtonElement>, key: string) {
    const delta = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
    if (!delta) return;
    e.preventDefault();
    const suivant = decalerCle(cles, key, delta);
    if (suivant.join() === cles.join()) return;
    aRefocaliser.current = key;
    onOrdre(suivant);
    setAnnonce(annonceDeplacement(suivant.indexOf(key) + 1, suivant.length));
  }

  function auDepart(e: PointerEvent<HTMLButtonElement>, key: string) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    setGlisse(key);
  }

  return (
    <div className="flex flex-col gap-3">
      <ol ref={listeRef} className="flex flex-col gap-3">
        {questions.map((q, i) => {
          const active = q.key === courante;
          const probleme = problemeQuestion(q);
          const souleve = glisse === q.key;
          return (
            <li
              key={q.key}
              ref={(el) => {
                if (el) lignes.current.set(q.key, el);
                else lignes.current.delete(q.key);
              }}
              className={cn(
                "flex min-h-16 items-center gap-2 rounded-md border-trait border-vert-foret bg-creme p-2 text-vert-foret",
                active && "bg-vert-foret text-creme shadow-relief-vif",
                souleve && "-rotate-2 bg-jaune-soleil text-vert-foret shadow-relief-lg",
              )}
            >
              <button
                type="button"
                onClick={() => onSelect(q.key)}
                aria-current={active ? "step" : undefined}
                className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left"
              >
                <span
                  className={cn(
                    "grid size-10 shrink-0 place-items-center rounded-sm bg-vert-foret font-affiche text-lg text-jaune-soleil",
                    active && "bg-jaune-soleil text-vert-foret",
                  )}
                >
                  <span className="sr-only">Question </span>
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 text-sm leading-tight font-bold">
                  <span className="block break-words">{q.prompt.trim() || "Question sans énoncé"}</span>
                  {probleme ? (
                    <span className="mt-1 inline-block rounded-sm bg-mangue px-1 font-extrabold text-vert-nuit">{probleme}</span>
                  ) : (
                    <span className={cn("block font-semibold", active && !souleve ? "text-creme" : "text-vert-mousse")}>{libelleQuestion(q)}</span>
                  )}
                  {estComplete(q) ? null : <span className="sr-only"> - à compléter</span>}
                </span>
              </button>
              <button
                type="button"
                ref={(el) => {
                  if (el) poignees.current.set(q.key, el);
                  else poignees.current.delete(q.key);
                }}
                aria-label={`Déplacer la question ${i + 1}`}
                aria-describedby={aideId}
                onKeyDown={(e) => auClavier(e, q.key)}
                onPointerDown={(e) => auDepart(e, q.key)}
                className="grid size-11 shrink-0 cursor-grab touch-none place-items-center"
              >
                <GripVertical aria-hidden="true" className="size-6" />
              </button>
            </li>
          );
        })}
      </ol>
      <p id={aideId} className="text-sm font-semibold text-vert-mousse">
        Au clavier : place le focus sur une poignée puis utilise les flèches haut et bas.
      </p>
      <p role="status" className="sr-only">
        {annonce}
      </p>
      {/* aria-disabled plutôt que disabled : le bouton reste au focus et son aide est lue avec lui. */}
      <button
        type="button"
        onClick={peutAjouter ? onAjouter : undefined}
        aria-disabled={peutAjouter ? undefined : true}
        aria-describedby={peutAjouter ? undefined : limiteId}
        className={buttonClasses({
          bloc: true,
          taille: enFeuille ? "normal" : "petit",
          variante: enFeuille ? "primaire" : "creme",
          inactif: !peutAjouter,
          className: enFeuille ? undefined : "border-dashed",
        })}
      >
        <Plus aria-hidden="true" className="size-5" />
        Ajouter une question
      </button>
      {peutAjouter ? null : (
        <p id={limiteId} className="text-sm font-extrabold">
          {AIDE_LIMITE_QUESTIONS}
        </p>
      )}
    </div>
  );
}

// Le glisser fait défiler le premier ancêtre qui défile vraiment : la colonne de bureau, la feuille mobile, sinon la page.
// Feuille ouverte, la page est verrouillée (overflow hidden) : elle ne doit pas bouger derrière le voile.
function zoneDefilante(depart: HTMLElement | null): HTMLElement | null {
  for (let el = depart?.parentElement ?? null; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight) return el;
  }
  const page = document.scrollingElement as HTMLElement | null;
  return page && getComputedStyle(document.documentElement).overflowY !== "hidden" ? page : null;
}
