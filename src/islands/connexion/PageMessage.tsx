import type { ReactNode } from "react";
import { Button } from "../../components/ui/button";
import { Explosion } from "../../components/ui/explosion";
import { Marque } from "../../components/ui/marque";
import { TitreAffiche } from "../../components/ui/titre-affiche";

interface Props {
  code: string;
  titre: string;
  children: ReactNode;
}

// Page plein écran (404, 500, aucune méthode de connexion) : rendue côté serveur, sans hydratation.
export default function PageMessage({ code, titre, children }: Props) {
  return (
    <main className="flex min-h-dvh flex-col items-center gap-6 px-4 py-8 text-center">
      <Marque />
      <div className="flex flex-1 flex-col items-center justify-center gap-5">
        <Explosion variante="piment" className="size-badge-petit font-affiche text-4xl">
          <span aria-hidden="true">{code}</span>
        </Explosion>
        <TitreAffiche className="max-w-xs text-3xl">{titre}</TitreAffiche>
        <p className="max-w-xs text-base font-bold text-vert-foret">{children}</p>
        <Button href="/" bloc className="max-w-xs">
          Retour à l'accueil
        </Button>
      </div>
    </main>
  );
}
