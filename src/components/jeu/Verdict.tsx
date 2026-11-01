import { useId } from "react";
import { LazyMotion, MotionConfig, domAnimation, m } from "motion/react";
import { Forme } from "../ui/forme";
import { cn } from "../ui/cn";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

interface Props {
  correct: boolean;
  // Phrase sous le badge, ex. « +1 bonne réponse. Bien joué, Grâce ! ».
  message: string;
  className?: string;
}

const confettis = [
  { left: "10%", delai: 0, couleur: "bg-vert-foret" },
  { left: "24%", delai: 0.4, couleur: "bg-creme" },
  { left: "76%", delai: 0.2, couleur: "bg-vert-vif" },
  { left: "88%", delai: 0.8, couleur: "bg-vert-foret" },
  { left: "64%", delai: 1.1, couleur: "bg-creme" },
];

// Seuls « JUSTE ! » et « Pas cette fois ! » existent : jamais « Faux ». Le titre est un span role=heading,
// car un <h2> ne peut pas vivre dans le <span> de la forme.
export function Verdict({ correct, message, className }: Props) {
  const reduced = usePrefersReducedMotion();
  const titreId = useId();
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">
        <section aria-labelledby={titreId} className={className}>
          <div className={cn("relative grid place-items-center overflow-hidden", correct ? "h-scene" : "h-scene-basse")}>
            {correct && !reduced
              ? confettis.map((c) => (
                  <m.i
                    key={c.left}
                    aria-hidden="true"
                    className={cn("absolute top-0 h-4 w-2", c.couleur)}
                    style={{ left: c.left }}
                    initial={{ y: -40, opacity: 0, rotate: 0 }}
                    animate={{ y: 260, opacity: [0, 1, 1, 0], rotate: 320 }}
                    transition={{ duration: 2.4, delay: c.delai, ease: "easeIn" }}
                  />
                ))
              : null}
            <m.div
              initial={{ scale: 0.3, rotate: correct ? -14 : 14 }}
              animate={{ scale: 1, rotate: correct ? -6 : 4 }}
              transition={{ type: "spring", stiffness: 260, damping: 14 }}
              className={correct ? "w-badge-grand" : "w-badge-moyen"}
            >
              <Forme forme="etoile" variante={correct ? "eclat" : "creme"} className="size-full">
                <span
                  id={titreId}
                  role="heading"
                  aria-level={2}
                  className={cn("font-badge leading-none tracking-wider", correct ? "text-4xl text-vert-nuit" : "text-3xl text-piment")}
                >
                  {correct ? (
                    "JUSTE !"
                  ) : (
                    <>
                      PAS CETTE
                      <br />
                      FOIS !
                    </>
                  )}
                </span>
              </Forme>
            </m.div>
          </div>
          <p className="px-6 text-center font-affiche text-xl">{message}</p>
        </section>
      </MotionConfig>
    </LazyMotion>
  );
}
