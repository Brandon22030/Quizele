import { useEffect, useId, useRef, useState } from "react";
import { Copy, Ellipsis, Eye, Pencil, Play, Trash2 } from "lucide-react";
import { IconButton } from "../../components/ui/button";
import { cn } from "../../components/ui/cn";
import { urlEditeur } from "./logique";

interface MenuCarteProps {
  quizId: string;
  titre: string;
  /** Fourni pour un brouillon : « Lancer » n'est alors pas l'action principale de la carte. */
  onLancer?: () => void;
  onDupliquer: () => void;
  onSupprimer: () => void;
  /** Prévient la carte : un menu ouvert doit passer au-dessus de la carte suivante. */
  onOuverture?: (ouvert: boolean) => void;
}

const boutonMenu = (racine: HTMLElement | null) => racine?.querySelector<HTMLButtonElement>("button[aria-controls]") ?? null;

const lienMenu = "flex min-h-11 w-full items-center gap-3 rounded-sm px-3 text-left font-bold no-underline hover:bg-jaune-soleil";

// Menu en divulgation (bouton + liste d'actions) plutôt que role="menu" : pas de gestion de flèches à maintenir, et
// chaque action reste un vrai lien ou bouton pour les lecteurs d'écran.
export function MenuCarte({ quizId, titre, onLancer, onDupliquer, onSupprimer, onOuverture }: MenuCarteProps) {
  const [ouvert, setOuvert] = useState(false);
  const racine = useRef<HTMLDivElement>(null);
  const panneauId = useId();

  function basculer(valeur: boolean) {
    setOuvert(valeur);
    onOuverture?.(valeur);
  }

  // Le focus passe sur « … » avant la fermeture : sinon il reste sur une action masquée et retombe sur body,
  // et une modale ouverte par l'action rendrait plus tard le focus à ce bouton invisible.
  function agir(action: () => void) {
    boutonMenu(racine.current)?.focus();
    basculer(false);
    action();
  }

  useEffect(() => {
    if (!ouvert) return;
    const surTouche = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOuvert(false);
      onOuverture?.(false);
      boutonMenu(racine.current)?.focus();
    };
    const surClic = (e: PointerEvent) => {
      if (!racine.current || racine.current.contains(e.target as Node)) return;
      const bouton = boutonMenu(racine.current);
      const focusDansMenu = racine.current.contains(document.activeElement);
      setOuvert(false);
      onOuverture?.(false);
      if (!bouton || !focusDansMenu) return;
      bouton.focus();
      // Le clic qui suit déplace le focus : on le laisse partir vers un élément focalisable, mais un clic dans le vide
      // le ferait tomber sur body, d'où le retour sur « … ». La vérification attend la fin de ce déplacement.
      bouton.addEventListener(
        "focusout",
        (sortie) => {
          if (sortie.relatedTarget !== null) return;
          setTimeout(() => {
            if (document.activeElement === document.body) bouton.focus();
          }, 0);
        },
        { once: true },
      );
    };
    document.addEventListener("keydown", surTouche);
    document.addEventListener("pointerdown", surClic);
    return () => {
      document.removeEventListener("keydown", surTouche);
      document.removeEventListener("pointerdown", surClic);
    };
  }, [ouvert, onOuverture]);

  return (
    <div ref={racine} className="relative">
      <IconButton
        label={`Plus d'actions pour ${titre}`}
        icone={<Ellipsis className="size-5" />}
        aria-expanded={ouvert}
        aria-controls={panneauId}
        data-menu-quiz={quizId}
        onClick={() => basculer(!ouvert)}
      />
      <ul
        id={panneauId}
        hidden={!ouvert}
        data-papier=""
        className="absolute top-full right-0 z-40 mt-2 w-menu rounded-md border-trait border-vert-foret bg-creme p-2 text-vert-foret shadow-relief"
      >
        <li>
          <a href={urlEditeur(quizId)} className={lienMenu}>
            <Pencil aria-hidden="true" className="size-5" />
            Modifier
          </a>
        </li>
        <li>
          <a href={`${urlEditeur(quizId)}/apercu`} className={lienMenu}>
            <Eye aria-hidden="true" className="size-5" />
            Essayer comme un joueur
          </a>
        </li>
        {onLancer ? (
          <li>
            <button
              type="button"
              className={lienMenu}
              onClick={() => agir(onLancer)}
            >
              <Play aria-hidden="true" className="size-5" />
              Lancer
            </button>
          </li>
        ) : null}
        <li>
          <button
            type="button"
            className={lienMenu}
            onClick={() => agir(onDupliquer)}
          >
            <Copy aria-hidden="true" className="size-5" />
            Dupliquer
          </button>
        </li>
        <li aria-hidden="true">
          <hr className="my-1 border-trait border-x-0 border-b-0 border-dashed border-vert-foret" />
        </li>
        <li>
          <button
            type="button"
            className={cn(lienMenu, "text-piment")}
            onClick={() => agir(onSupprimer)}
          >
            <Trash2 aria-hidden="true" className="size-5" />
            Supprimer
          </button>
        </li>
      </ul>
    </div>
  );
}
