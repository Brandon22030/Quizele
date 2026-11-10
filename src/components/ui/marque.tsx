import type { AnchorHTMLAttributes } from "react";
import { cn } from "./cn";

export function Marque({ className, href = "/", ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      href={href}
      className={cn(
        "inline-flex min-h-11 items-center gap-2 rounded-pill bg-vert-foret py-1 pr-3 pl-1 text-creme no-underline",
        className,
      )}
      {...rest}
    >
      <span
        aria-hidden="true"
        className="forme-explosion grid size-pastille-marque -rotate-8 place-items-center bg-jaune-soleil font-affiche text-lg text-vert-foret"
      >
        ?
      </span>
      <span className="font-affiche text-lg leading-none tracking-wide">Quizdeszeles</span>
    </a>
  );
}
