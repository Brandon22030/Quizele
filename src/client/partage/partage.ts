import type { ShareOptions, ShareResult } from "./types";

export interface ShareDeps {
  navigator?: Pick<Navigator, "canShare" | "share">;
  download?: (blob: Blob, filename: string) => void;
}

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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Le partage a échoué.";
}

/**
 * Partage le PNG avec Web Share niveau 2 si le navigateur accepte les fichiers, sinon le télécharge.
 * Ne lève jamais : l'annulation de la feuille de partage et les erreurs sont des résultats typés.
 */
export async function sharePng(blob: Blob, options: ShareOptions, deps: ShareDeps = {}): Promise<ShareResult> {
  const nav = deps.navigator ?? (typeof navigator === "undefined" ? undefined : navigator);
  const download = deps.download ?? downloadBlob;
  try {
    const file = new File([blob], options.filename, { type: "image/png" });
    if (nav && typeof nav.canShare === "function" && typeof nav.share === "function" && nav.canShare({ files: [file] })) {
      await nav.share({ files: [file], title: options.title, text: options.text });
      return { status: "shared" };
    }
    download(blob, options.filename);
    return { status: "downloaded" };
  } catch (error) {
    if (errorName(error) === "AbortError") return { status: "cancelled" };
    return { status: "error", message: errorMessage(error) };
  }
}
