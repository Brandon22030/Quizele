import { Check, TriangleAlert } from "lucide-react";
import { Papier } from "../../components/ui/papier";
import { cn } from "../../components/ui/cn";
import type { Verification } from "./logique";

interface Props {
  verifications: Verification[];
}

// Point vert (tout va bien) ou orange (à corriger) : l'icône double la couleur pour ne pas dépendre d'elle.
export function ListeVerification({ verifications }: Props) {
  return (
    <Papier className="mx-4 mt-6 px-4 py-5">
      <ul aria-label="Vérifications avant le lancement" className="m-0 flex list-none flex-col gap-4 p-0">
        {verifications.map((v) => (
          <li key={v.id} className="flex items-start gap-3 font-bold">
            <span
              aria-hidden="true"
              className={cn(
                "mt-1 grid size-8 shrink-0 place-items-center rounded-full border-trait border-vert-foret",
                v.etat === "ok" ? "bg-vert-eclat text-vert-nuit" : "bg-mangue text-vert-nuit",
              )}
            >
              {v.etat === "ok" ? <Check className="size-5" /> : <TriangleAlert className="size-5" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="py-1">
                <span className="sr-only">{v.etat === "ok" ? "Vérifié : " : "À corriger : "}</span>
                {v.texte}
              </p>
              {v.liens.length > 0 ? (
                <ul className="m-0 flex list-none flex-col p-0">
                  {v.liens.map((lien) => (
                    <li key={lien.href}>
                      <a href={lien.href} className="inline-flex min-h-11 items-center font-extrabold text-vert-foret underline decoration-trait underline-offset-4">
                        {lien.libelle}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </Papier>
  );
}
