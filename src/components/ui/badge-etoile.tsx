import { Forme, type FormeProps } from "./forme";

/** Étoile à exclamation : texte en Bangers, légèrement penché comme sur l'affiche. */
export function BadgeEtoile({ className, children, ...rest }: FormeProps) {
  return (
    <Forme forme="etoile" className={className} {...rest}>
      <span className="-rotate-6 font-badge text-sm uppercase leading-none tracking-wide">{children}</span>
    </Forme>
  );
}
