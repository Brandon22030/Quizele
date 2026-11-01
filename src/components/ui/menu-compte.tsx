import { useEffect, useId, useRef, useState } from "react";
import { LogOut } from "lucide-react";
import { cn } from "./cn";

interface MenuCompteProps {
  nom: string;
  email: string;
  deconnexionHref: string;
  className?: string;
}

export function MenuCompte({ nom, email, deconnexionHref, className }: MenuCompteProps) {
  const [ouvert, setOuvert] = useState(false);
  const racine = useRef<HTMLDivElement>(null);
  const bouton = useRef<HTMLButtonElement>(null);
  const panneauId = useId();
  const initiale = nom.trim().charAt(0).toUpperCase() || "?";

  useEffect(() => {
    if (!ouvert) return;
    const surTouche = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOuvert(false);
      bouton.current?.focus();
    };
    const surClic = (e: PointerEvent) => {
      if (racine.current && !racine.current.contains(e.target as Node)) setOuvert(false);
    };
    document.addEventListener("keydown", surTouche);
    document.addEventListener("pointerdown", surClic);
    return () => {
      document.removeEventListener("keydown", surTouche);
      document.removeEventListener("pointerdown", surClic);
    };
  }, [ouvert]);

  return (
    <div ref={racine} className={cn("relative", className)}>
      <button
        ref={bouton}
        type="button"
        aria-label={`Menu du compte de ${nom}`}
        aria-expanded={ouvert}
        aria-controls={panneauId}
        onClick={() => setOuvert((v) => !v)}
        className="grid size-11 place-items-center rounded-full border-trait border-vert-foret bg-vert-foret font-affiche text-lg text-jaune-soleil shadow-relief-sm foret:border-creme"
      >
        <span aria-hidden="true">{initiale}</span>
      </button>
      <div
        id={panneauId}
        hidden={!ouvert}
        data-papier=""
        className="absolute top-full right-0 z-40 mt-2 w-64 rounded-md border-trait border-vert-foret bg-creme p-2 text-vert-foret shadow-relief"
      >
        <div className="px-3 py-2">
          <p className="truncate font-extrabold">{nom}</p>
          <p className="truncate text-sm font-semibold text-vert-mousse">{email}</p>
        </div>
        <hr className="my-1 border-trait border-x-0 border-b-0 border-dashed border-vert-foret" />
        {/* POST : une déconnexion modifie l'état serveur, un lien GET serait déclenchable par préchargement ou par un tiers. */}
        <form method="post" action={deconnexionHref}>
          <button
            type="submit"
            className="flex min-h-11 w-full items-center gap-3 rounded-sm px-3 text-left font-bold hover:bg-jaune-soleil"
          >
            <LogOut aria-hidden="true" className="size-5" />
            Se déconnecter
          </button>
        </form>
      </div>
    </div>
  );
}
