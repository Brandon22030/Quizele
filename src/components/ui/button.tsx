import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "./cn";

export type ButtonVariant = "primaire" | "soleil" | "creme";
export type ButtonSize = "normal" | "petit";

const base =
  "inline-flex items-center justify-center gap-2 border-trait border-vert-foret font-affiche tracking-wide whitespace-nowrap no-underline select-none " +
  "transition-transform hover:-translate-y-px hover:translate-x-px " +
  "active:-translate-x-1 active:translate-y-1 active:shadow-relief-appui";

const variants: Record<ButtonVariant, string> = {
  primaire: "bg-vert-foret text-jaune-soleil shadow-relief-vif foret:border-creme",
  soleil: "bg-jaune-soleil text-vert-foret shadow-relief foret:border-vert-nuit",
  creme: "bg-creme text-vert-foret shadow-relief foret:border-vert-nuit",
};

const sizes: Record<ButtonSize, string> = {
  normal: "min-h-14 rounded-md px-6 text-lg",
  petit: "min-h-11 rounded-sm px-4 text-base shadow-relief-sm",
};

// Un état désactivé ne baisse pas l'opacité du texte (contraste AA) : contour pointillé, fond crème (lisible sur jaune comme
// sur forêt) et relief retiré.
const disabledClasses =
  "cursor-not-allowed border-dashed bg-creme text-vert-mousse shadow-none hover:translate-x-0 hover:translate-y-0 " +
  "active:translate-x-0 active:translate-y-0 active:shadow-none foret:border-creme";

interface CommonProps {
  variante?: ButtonVariant;
  taille?: ButtonSize;
  bloc?: boolean;
  children: ReactNode;
}

interface LoadingProps {
  chargement?: boolean;
  libelleChargement?: string;
}

type ButtonProps = CommonProps & LoadingProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & { href?: undefined };
// Un lien navigue : il n'a pas d'état de chargement (rien à bloquer, le navigateur affiche déjà la navigation).
type LinkProps = CommonProps & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "children"> & { href: string; chargement?: never; libelleChargement?: never };

export function buttonClasses({
  variante = "primaire",
  taille = "normal",
  bloc = false,
  inactif = false,
  className,
}: {
  variante?: ButtonVariant;
  taille?: ButtonSize;
  bloc?: boolean;
  inactif?: boolean;
  className?: string;
}): string {
  return cn(base, variants[variante], sizes[taille], bloc && "w-full", inactif && disabledClasses, className);
}

export function Button(props: ButtonProps | LinkProps) {
  const { variante, taille, bloc, chargement = false, libelleChargement = "Chargement en cours", children, className, ...rest } = props;
  const contenu = (
    <>
      {chargement ? (
        <>
          <LoaderCircle aria-hidden="true" className="size-5 animate-spin motion-reduce:animate-none" />
          <span className="sr-only">{libelleChargement}</span>
        </>
      ) : null}
      {children}
    </>
  );

  if (rest.href !== undefined) {
    const { href, ...lien } = rest as Omit<LinkProps, keyof CommonProps | keyof LoadingProps>;
    return (
      <a href={href} className={buttonClasses({ variante, taille, bloc, className })} {...lien}>
        {contenu}
      </a>
    );
  }

  const { disabled, type = "button", ...bouton } = rest as Omit<ButtonProps, keyof CommonProps | keyof LoadingProps>;
  const inactif = Boolean(disabled);
  return (
    <button
      type={type}
      // aria-disabled (et non disabled) pendant le chargement : le bouton garde le focus et reste annoncé.
      disabled={disabled}
      aria-disabled={chargement || undefined}
      aria-busy={chargement || undefined}
      className={buttonClasses({ variante, taille, bloc, inactif, className })}
      {...bouton}
      onClick={chargement ? (e) => e.preventDefault() : bouton.onClick}
    >
      {contenu}
    </button>
  );
}

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> {
  /** Nom accessible : un bouton icône n'a pas de texte visible. */
  label: string;
  icone: ReactNode;
  variante?: "creme" | "soleil";
  danger?: boolean;
}

export function IconButton({ label, icone, variante = "creme", danger = false, className, type = "button", ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      className={cn(
        "grid size-11 shrink-0 place-items-center rounded-sm border-trait border-vert-foret shadow-relief-sm",
        "transition-transform active:-translate-x-1 active:translate-y-1 active:shadow-relief-appui",
        "foret:border-vert-nuit",
        variante === "soleil" ? "bg-jaune-soleil" : "bg-creme",
        danger ? "text-piment" : "text-vert-foret",
        "disabled:cursor-not-allowed disabled:border-dashed disabled:bg-creme disabled:text-vert-mousse disabled:shadow-none foret:disabled:border-creme",
        className,
      )}
      {...rest}
    >
      <span aria-hidden="true" className="grid place-items-center">
        {icone}
      </span>
    </button>
  );
}
