import { describe, expect, it, vi } from "vitest";
import { messagePartage, sharePng } from "../../../src/client/partage/partage";

const blob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
const options = { filename: "resultat.png", title: "Mon résultat" };

function nomme(nom: string, message = "x"): Error {
  const erreur = new Error(message);
  erreur.name = nom;
  return erreur;
}

describe("sharePng", () => {
  it("partage le fichier quand canShare accepte les fichiers", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    const download = vi.fn();
    const resultat = await sharePng(blob, options, { navigator: { canShare, share }, download });
    expect(resultat).toEqual({ status: "shared" });
    const donnees = share.mock.calls[0][0] as { files: File[]; title: string };
    expect(donnees.files[0].name).toBe("resultat.png");
    expect(donnees.files[0].type).toBe("image/png");
    expect(donnees.title).toBe("Mon résultat");
    expect(download).not.toHaveBeenCalled();
  });

  it("télécharge quand canShare refuse les fichiers", async () => {
    const share = vi.fn();
    const download = vi.fn();
    const resultat = await sharePng(blob, options, { navigator: { canShare: () => false, share }, download });
    expect(resultat).toEqual({ status: "downloaded" });
    expect(share).not.toHaveBeenCalled();
    expect(download).toHaveBeenCalledWith(blob, "resultat.png");
  });

  it("télécharge quand le navigateur n'a pas Web Share", async () => {
    const download = vi.fn();
    const resultat = await sharePng(blob, options, { navigator: {} as Navigator, download });
    expect(resultat).toEqual({ status: "downloaded" });
    expect(download).toHaveBeenCalledOnce();
  });

  it("traite l'annulation comme un résultat, sans téléchargement ni exception", async () => {
    const share = vi.fn().mockRejectedValue(nomme("AbortError"));
    const download = vi.fn();
    const resultat = await sharePng(blob, options, { navigator: { canShare: () => true, share }, download });
    expect(resultat).toEqual({ status: "cancelled" });
    expect(download).not.toHaveBeenCalled();
  });

  it("renvoie une erreur typée en français quand le partage échoue", async () => {
    const share = vi.fn().mockRejectedValue(nomme("DataError", "Invalid data"));
    const download = vi.fn();
    const resultat = await sharePng(blob, options, { navigator: { canShare: () => true, share }, download });
    expect(resultat).toEqual({ status: "error", message: "Le partage a échoué. Réessaie." });
    expect(download).not.toHaveBeenCalled();
  });

  it("renvoie une erreur typée en français quand le téléchargement échoue", async () => {
    const download = vi.fn(() => {
      throw new Error("disque plein");
    });
    const resultat = await sharePng(blob, options, { navigator: { canShare: () => false, share: vi.fn() }, download });
    expect(resultat).toEqual({ status: "error", message: "Le téléchargement de l'image a échoué. Réessaie." });
  });

  it("geste expiré sur Safari iOS (NotAllowedError) : télécharge le même PNG", async () => {
    const message = "The request is not allowed by the user agent or the platform in the current context, possibly because the user denied permission.";
    const download = vi.fn();
    const share = vi.fn().mockRejectedValue(nomme("NotAllowedError", message));
    const resultat = await sharePng(blob, options, { navigator: { canShare: () => true, share }, download });
    expect(resultat).toEqual({ status: "downloaded" });
    expect(download).toHaveBeenCalledWith(blob, "resultat.png");
  });

  it("Web Share interdit par la politique de permissions (NotAllowedError) : télécharge aussi", async () => {
    const download = vi.fn();
    const share = vi.fn().mockRejectedValue(nomme("NotAllowedError", "Failed to execute 'share' on 'Navigator': Permission denied."));
    const resultat = await sharePng(blob, options, { navigator: { canShare: () => true, share }, download });
    expect(resultat).toEqual({ status: "downloaded" });
    expect(download).toHaveBeenCalledWith(blob, "resultat.png");
  });

  it("repli iOS dont le téléchargement échoue : erreur en français", async () => {
    const download = vi.fn(() => {
      throw new Error("quota");
    });
    const share = vi.fn().mockRejectedValue(nomme("NotAllowedError", "The request is not allowed"));
    const resultat = await sharePng(blob, options, { navigator: { canShare: () => true, share }, download });
    expect(resultat).toEqual({ status: "error", message: "Le téléchargement de l'image a échoué. Réessaie." });
  });
});

describe("messagePartage", () => {
  it("donne un texte français par statut, rien pour l'annulation", () => {
    expect(messagePartage({ status: "shared" })).toBe("Image partagée.");
    expect(messagePartage({ status: "downloaded" })).toBe("Image téléchargée.");
    expect(messagePartage({ status: "cancelled" })).toBeNull();
    expect(messagePartage({ status: "error", message: "Le partage a échoué. Réessaie." })).toBe("Le partage a échoué. Réessaie.");
  });

  it("annonce le message d'erreur renvoyé par sharePng", async () => {
    const share = vi.fn().mockRejectedValue(nomme("TypeError", "boom"));
    const resultat = await sharePng(blob, options, { navigator: { canShare: () => true, share }, download: vi.fn() });
    expect(messagePartage(resultat)).toBe("Le partage a échoué. Réessaie.");
  });
});
