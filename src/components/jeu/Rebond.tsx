import { motion, useReducedMotion } from "motion/react";
import { cx } from "./cx";

interface Props {
  className?: string;
}

// Trois points qui rebondissent : attente d'un événement du serveur. Fixes sous prefers-reduced-motion.
export function Rebond({ className }: Props) {
  const reduced = useReducedMotion();
  return (
    <span aria-hidden="true" className={cx("inline-flex items-center", className)}>
      {[0, 1, 2].map((i) => (
        <motion.i
          key={i}
          className="mx-1 inline-block size-3.5 rounded-full bg-vert-foret"
          animate={reduced ? undefined : { y: [0, -12, 0, 0] }}
          transition={{ duration: 1, repeat: Infinity, delay: i * 0.15, times: [0, 0.4, 0.8, 1] }}
        />
      ))}
    </span>
  );
}
