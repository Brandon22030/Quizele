import { useSyncExternalStore } from "react";

const sansAbonnement = () => () => {};

/**
 * Faux au rendu serveur et pendant l'hydratation, vrai ensuite. Les dates se formatent dans le fuseau du navigateur,
 * que le serveur ne connaît pas : les rendre côté serveur produirait un décalage d'hydratation. Une carte montée plus
 * tard côté client (changement d'onglet) reçoit directement vrai, sans image vide.
 */
export function useCoteClient(): boolean {
  return useSyncExternalStore(
    sansAbonnement,
    () => true,
    () => false,
  );
}

interface DateLocaleProps {
  date: Date;
  format: (date: Date) => string;
  /** Texte placé devant la date, masqué avec elle tant qu'elle n'est pas formatée. */
  prefixe?: string;
}

// L'espace réservé est hidden : rien d'incomplet n'est lu par un lecteur d'écran avant l'hydratation.
export function DateLocale({ date, format, prefixe = "" }: DateLocaleProps) {
  const client = useCoteClient();
  return (
    <span hidden={!client}>
      {client ? prefixe : ""}
      <time dateTime={date.toISOString()}>{client ? format(date) : ""}</time>
    </span>
  );
}
