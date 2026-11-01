import type { ShareOptions, ShareResult } from "./types";

export interface ShareDeps {
  navigator?: Pick<Navigator, "canShare" | "share">;
  download?: (blob: Blob, filename: string) => void;
}

// Messages fixes : le texte brut du navigateur est en anglais et parfois technique, il n'est jamais affiché.
const MESSAGES = {
  bloque: "Le partage a été bloqué par le navigateur.",
  echec: "Le partage a échoué. Réessaie.",
  telechargement: "Le téléchargement de l'image a échoué. Réessaie.",
} as const;

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Révocation différée : certains navigateurs lisent l'URL après le retour de click().
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function errorName(error: unknown): string {
  return error instanceof Error || (typeof error === "object" && error !== null && "name" in error)
    ? String((error as { name: unknown }).name)
    : "";
}

// NotAllowedError couvre deux situations. Safari iOS la lève quand le geste utilisateur a expiré (génération trop
// longue entre le clic et share) : le téléchargement reste possible et sert de repli. Chrome la lève avec
// un message terminé par « Permission denied » quand la politique de permissions interdit Web Share (iframe sans
// allow="web-share") : c'est un refus délibéré de la page hôte, on le signale au lieu de le contourner.
function isPolicyDenial(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /permission denied\.?$/i.test(message.trim());
}

/** Texte à annoncer dans une région role="status" après un partage ; null quand il n'y a rien à dire (annulation). */
export function messagePartage(result: ShareResult): string | null {
  switch (result.status) {
    case "shared":
      return "Image partagée.";
    case "downloaded":
      return "Image téléchargée.";
    case "cancelled":
      return null;
    case "error":
      return result.message;
  }
}

function telecharger(download: NonNullable<ShareDeps["download"]>, blob: Blob, filename: string): ShareResult {
  try {
    download(blob, filename);
    return { status: "downloaded" };
  } catch {
    return { status: "error", message: MESSAGES.telechargement };
  }
}

/**
 * Partage le PNG avec Web Share niveau 2 si le navigateur accepte les fichiers, sinon le télécharge.
 * Ne lève jamais : l'annulation de la feuille de partage et les erreurs sont des résultats typés.
 */
export async function sharePng(blob: Blob, options: ShareOptions, deps: ShareDeps = {}): Promise<ShareResult> {
  const nav = deps.navigator ?? (typeof navigator === "undefined" ? undefined : navigator);
  const download = deps.download ?? downloadBlob;
  let partageable: boolean;
  let file: File;
  try {
    file = new File([blob], options.filename, { type: "image/png" });
    partageable = !!nav && typeof nav.canShare === "function" && typeof nav.share === "function" && nav.canShare({ files: [file] });
  } catch {
    return { status: "error", message: MESSAGES.echec };
  }
  if (!partageable || !nav) return telecharger(download, blob, options.filename);
  try {
    await nav.share({ files: [file], title: options.title, text: options.text });
    return { status: "shared" };
  } catch (error) {
    const nom = errorName(error);
    if (nom === "AbortError") return { status: "cancelled" };
    if (nom === "NotAllowedError") {
      return isPolicyDenial(error) ? { status: "error", message: MESSAGES.bloque } : telecharger(download, blob, options.filename);
    }
    return { status: "error", message: MESSAGES.echec };
  }
}
