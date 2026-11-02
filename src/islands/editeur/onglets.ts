import { localNow } from "../../shared/clock";

// Coordination entre onglets du même navigateur : un brouillon de nouveau quiz n'est repris que par un seul onglet, sinon
// chacun créerait son propre exemplaire du quiz côté serveur. Le premier onglet garde la session ; les suivants s'effacent.
// Sur un quiz existant, chaque écriture confirmée par le serveur est signalée aux autres onglets ouverts sur le même quiz.

export type MessageOnglet =
  | { type: "qui"; session: string; onglet: string }
  | { type: "moi"; session: string }
  | { type: "ecrit"; quizId: string; onglet: string };

export interface Canal {
  envoyer(message: MessageOnglet): void;
  ecouter(fn: (message: MessageOnglet) => void): () => void;
  fermer(): void;
}

const NOM_CANAL = "quizdeszeles:onglets";
export const ATTENTE_REPONSE_MS = 250;

function estMessage(valeur: unknown): valeur is MessageOnglet {
  if (typeof valeur !== "object" || valeur === null) return false;
  const m = valeur as { type?: unknown; session?: unknown; onglet?: unknown; quizId?: unknown };
  if (m.type === "ecrit") return typeof m.quizId === "string" && typeof m.onglet === "string";
  if (typeof m.session !== "string") return false;
  return m.type === "moi" || (m.type === "qui" && typeof m.onglet === "string");
}

export function nouvelIdentifiant(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${localNow().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function canalBroadcast(): Canal {
  const bc = new BroadcastChannel(NOM_CANAL);
  let ferme = false;
  return {
    // Une requête partie avant la fermeture de l'éditeur peut aboutir après : postMessage lèverait sur un canal fermé.
    envoyer: (m) => {
      if (!ferme) bc.postMessage(m);
    },
    ecouter(fn) {
      const recevoir = (e: MessageEvent) => {
        if (estMessage(e.data)) fn(e.data);
      };
      bc.addEventListener("message", recevoir);
      return () => bc.removeEventListener("message", recevoir);
    },
    fermer: () => {
      ferme = true;
      bc.close();
    },
  };
}

// Repli sans BroadcastChannel : l'événement `storage` n'est reçu que par les autres onglets. La clé est retirée aussitôt
// écrite, rien ne reste dans localStorage.
function canalStockage(stockage: Storage): Canal {
  return {
    envoyer(m) {
      try {
        stockage.setItem(NOM_CANAL, JSON.stringify({ ...m, n: nouvelIdentifiant() }));
        stockage.removeItem(NOM_CANAL);
      } catch {
        // Stockage plein ou refusé : l'onglet se comporte comme s'il était seul.
      }
    },
    ecouter(fn) {
      const recevoir = (e: StorageEvent) => {
        if (e.key !== NOM_CANAL || !e.newValue) return;
        try {
          const m: unknown = JSON.parse(e.newValue);
          if (estMessage(m)) fn(m);
        } catch {
          // Message illisible : ignoré.
        }
      };
      window.addEventListener("storage", recevoir);
      return () => window.removeEventListener("storage", recevoir);
    },
    fermer() {},
  };
}

export function canalNavigateur(): Canal | null {
  if (typeof window === "undefined") return null;
  if (typeof BroadcastChannel === "function") return canalBroadcast();
  try {
    return canalStockage(window.localStorage);
  } catch {
    return null;
  }
}

// Demande aux autres onglets si l'un d'eux détient la session. Deux onglets qui demandent en même temps se départagent par
// leur identifiant : le plus petit garde le brouillon, l'autre repart d'une page vierge.
export function sessionLibre(canal: Canal | null, session: string, onglet: string, attenteMs: number = ATTENTE_REPONSE_MS): Promise<boolean> {
  if (!canal) return Promise.resolve(true);
  return new Promise((resolve) => {
    let fini = false;
    const conclure = (libre: boolean) => {
      if (fini) return;
      fini = true;
      clearTimeout(minuterie);
      arreter();
      resolve(libre);
    };
    const arreter = canal.ecouter((m) => {
      if (m.type === "ecrit" || m.session !== session) return;
      if (m.type === "moi" || m.onglet < onglet) conclure(false);
      // Un onglet arrivé après notre question ne l'a pas reçue : on la repose pour qu'il s'efface devant nous.
      else if (m.onglet > onglet) canal.envoyer({ type: "qui", session, onglet });
    });
    const minuterie = setTimeout(() => conclure(true), attenteMs);
    canal.envoyer({ type: "qui", session, onglet });
  });
}

// Répond « moi » tant que l'onglet détient la session : un autre onglet ne reprendra pas ce brouillon.
export function detenirSession(canal: Canal | null, session: string): () => void {
  if (!canal) return () => {};
  return canal.ecouter((m) => {
    if (m.type === "qui" && m.session === session) canal.envoyer({ type: "moi", session });
  });
}

export function signalerEcriture(canal: Canal | null, quizId: string, onglet: string): void {
  canal?.envoyer({ type: "ecrit", quizId, onglet });
}

// Prévient quand un autre onglet a écrit sur le quiz affiché. Le quiz est lu à chaque message : /quiz/nouveau reçoit son
// identifiant en cours de route, à la création.
export function ecouterEcritures(canal: Canal | null, onglet: string, quizCourant: () => string | null, fn: () => void): () => void {
  if (!canal) return () => {};
  return canal.ecouter((m) => {
    if (m.type !== "ecrit" || m.onglet === onglet) return;
    const quizId = quizCourant();
    if (quizId !== null && m.quizId === quizId) fn();
  });
}
