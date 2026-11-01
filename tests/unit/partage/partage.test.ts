import { describe, expect, it, vi } from "vitest";
import { sharePng } from "../../../src/client/partage/partage";

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

  it("renvoie une erreur typée quand le partage échoue", async () => {
    const share = vi.fn().mockRejectedValue(nomme("NotAllowedError", "refusé"));
    const resultat = await sharePng(blob, options, { navigator: { canShare: () => true, share }, download: vi.fn() });
    expect(resultat).toEqual({ status: "error", message: "refusé" });
  });

  it("renvoie une erreur typée quand le téléchargement échoue", async () => {
    const download = vi.fn(() => {
      throw new Error("disque plein");
    });
    const resultat = await sharePng(blob, options, { navigator: { canShare: () => false, share: vi.fn() }, download });
    expect(resultat).toEqual({ status: "error", message: "disque plein" });
  });
});
