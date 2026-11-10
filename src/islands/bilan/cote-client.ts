import { useSyncExternalStore } from "react";

const sansAbonnement = () => () => {};

// Faux au rendu serveur et pendant l'hydratation, vrai ensuite : le fuseau est celui du navigateur, que le serveur
// ne connaît pas. Dupliqué du tableau de bord pour ne pas importer d'un îlot à l'autre.
export function useCoteClient(): boolean {
  return useSyncExternalStore(
    sansAbonnement,
    () => true,
    () => false,
  );
}
