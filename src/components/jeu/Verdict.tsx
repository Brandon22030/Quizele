import { useId } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Etoile } from "./Etoile";
import { cx } from "./cx";

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

// Seuls « JUSTE ! » et « Pas cette fois ! » existent : jamais « Faux ».
export function Verdict({ correct, message, className }: Props) {
  const reduced = useReducedMotion();
  const titreId = useId();
  return (
    <section aria-labelledby={titreId} className={className}>
      <div className={cx("relative grid place-items-center overflow-hidden", correct ? "h-75" : "h-65")}>
        {correct && !reduced
          ? confettis.map((c) => (
              <motion.i
                key={c.left}
                aria-hidden="true"
                className={cx("absolute top-0 h-4 w-2.5", c.couleur)}
                style={{ left: c.left }}
                initial={{ y: -40, opacity: 0, rotate: 0 }}
                animate={{ y: 260, opacity: [0, 1, 1, 0], rotate: 320 }}
                transition={{ duration: 2.4, delay: c.delai, ease: "easeIn" }}
              />
            ))
          : null}
        <motion.div
          initial={reduced ? false : { scale: 0.3, rotate: correct ? -14 : 14 }}
          animate={{ scale: 1, rotate: correct ? -6 : 4 }}
          transition={{ type: "spring", stiffness: 260, damping: 14 }}
        >
          <Etoile ton={correct ? "eclat" : "creme"} className={correct ? "w-60" : "w-55"}>
            <h2
              id={titreId}
              className={cx(
                "font-badge leading-none tracking-wider",
                correct ? "text-4xl text-vert-nuit" : "text-3xl text-piment",
              )}
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
            </h2>
          </Etoile>
        </motion.div>
      </div>
      <p className="px-6 text-center font-affiche text-xl leading-tight">{message}</p>
    </section>
  );
}
