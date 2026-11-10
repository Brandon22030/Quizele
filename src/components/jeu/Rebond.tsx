import { cn } from "../ui/cn";

interface Props {
  taille?: "normal" | "petit";
  className?: string;
}

// Trois points qui rebondissent : attente d'un événement du serveur. Le CSS les fige sous prefers-reduced-motion.
export function Rebond({ taille = "normal", className }: Props) {
  return (
    <span aria-hidden="true" className={cn("inline-flex items-center", className)}>
      {[0, 1, 2].map((i) => (
        <i
          key={i}
          className={cn("mx-1 inline-block animate-rebond rounded-full bg-vert-foret", taille === "petit" ? "size-2" : "size-3")}
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </span>
  );
}
