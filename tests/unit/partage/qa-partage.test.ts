import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { sharePng } from "../../../src/client/partage/partage";
import type { LeaderboardShareData, ResultShareData, ShareOptions } from "../../../src/client/partage/types";

const blob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
const options: ShareOptions = { filename: "resultat.png" };

function nomme(nom: string, message = "x"): Error {
  const e = new Error(message);
  e.name = nom;
  return e;
}

describe("QA partage : types d'entrée (AST)", () => {
  const fichier = ts.createSourceFile("types.ts", readFileSync("src/client/partage/types.ts", "utf8"), ts.ScriptTarget.Latest, true);
  const champs: string[] = [];
  const visiter = (n: ts.Node) => {
    if (ts.isPropertySignature(n) && n.name) champs.push(n.name.getText(fichier));
    ts.forEachChild(n, visiter);
  };
  visiter(fichier);

  it("aucun champ de bonne réponse, d'explication, de référence ou d'options, tous types confondus", () => {
    expect(champs.length).toBeGreaterThan(8);
    expect(champs.filter((c) => /correct|answer|reponse|solution|explanation|explication|reference|option|choice|isRight|valid|question/i.test(c))).toEqual([]);
  });

  it("n'accepte pas un champ de correction à la compilation", () => {
    const ok: ResultShareData = { quizTitle: "t", pseudo: "p", score: 0, total: 1, rank: 1, playerCount: 1, top: [] };
    // @ts-expect-error aucun champ de correction dans l'entrée
    const a: ResultShareData = { ...ok, correctAnswer: "B" };
    // @ts-expect-error idem pour le classement
    const b: LeaderboardShareData = { quizTitle: "t", total: 1, playerCount: 1, top: [], explanation: "x" };
    // @ts-expect-error idem pour les entrées du top
    const c: ResultShareData = { ...ok, top: [{ pseudo: "x", score: 1, options: [] }] };
    expect([a, b, c]).toHaveLength(3);
  });
});

describe("QA sharePng", () => {
  it("canShare absent mais share présent : téléchargement", async () => {
    const download = vi.fn();
    const r = await sharePng(blob, options, { navigator: { share: vi.fn() } as unknown as Navigator, download });
    expect(r).toEqual({ status: "downloaded" });
    expect(download).toHaveBeenCalledOnce();
  });

  it("canShare appelé avec le fichier PNG nommé", async () => {
    const canShare = vi.fn().mockReturnValue(false);
    await sharePng(blob, { filename: "classement.png" }, { navigator: { canShare, share: vi.fn() }, download: vi.fn() });
    const f = (canShare.mock.calls[0][0] as { files: File[] }).files[0];
    expect([f.name, f.type]).toEqual(["classement.png", "image/png"]);
  });

  it("canShare qui lève : résultat error, pas d'exception", async () => {
    const r = await sharePng(blob, options, { navigator: { canShare: () => { throw nomme("TypeError", "boum"); }, share: vi.fn() }, download: vi.fn() });
    expect(r.status).toBe("error");
  });

  it("rejet non-Error (chaîne) : error avec message, pas d'exception", async () => {
    const r = await sharePng(blob, options, { navigator: { canShare: () => true, share: vi.fn().mockRejectedValue("nope") }, download: vi.fn() });
    expect(r.status).toBe("error");
    expect((r as { message: string }).message).toBeTruthy();
  });

  it("AbortError sous forme d'objet simple (DOMException d'un autre contexte) : annulation", async () => {
    const r = await sharePng(blob, options, { navigator: { canShare: () => true, share: vi.fn().mockRejectedValue({ name: "AbortError" }) }, download: vi.fn() });
    expect(r).toEqual({ status: "cancelled" });
  });

  it("le message d'une autre erreur est en français, jamais le texte brut du navigateur", async () => {
    const r = await sharePng(blob, options, {
      navigator: { canShare: () => true, share: vi.fn().mockRejectedValue(nomme("NotAllowedError", "Permission denied")) },
      download: vi.fn(),
    });
    expect(r.status).toBe("error");
    const message = (r as { message: string }).message;
    expect(message).not.toMatch(/permission denied/i);
    expect(message).toMatch(/[éèàêç]|partage|impossible|échoué|réessaie/i);
  });
});

describe("QA sharePng : iOS", () => {
  it("NotAllowedError (geste utilisateur expiré) retombe sur le téléchargement", async () => {
    const download = vi.fn();
    const r = await sharePng(blob, options, {
      navigator: { canShare: () => true, share: vi.fn().mockRejectedValue(nomme("NotAllowedError", "The request is not allowed")) },
      download,
    });
    expect(r).toEqual({ status: "downloaded" });
    expect(download).toHaveBeenCalledOnce();
  });
});

describe("QA téléchargement par défaut", () => {
  const liens: Array<{ href: string; download: string; click: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> }> = [];
  beforeEach(() => {
    vi.useFakeTimers();
    liens.length = 0;
    vi.stubGlobal("document", {
      createElement: () => {
        const l = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
        liens.push(l);
        return l;
      },
      body: { appendChild: vi.fn() },
    });
    URL.createObjectURL = vi.fn(() => "blob:test-url");
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("télécharge avec le bon nom puis révoque l'URL objet", async () => {
    const r = await sharePng(blob, options, { navigator: {} as Navigator });
    expect(r).toEqual({ status: "downloaded" });
    expect(liens[0]).toMatchObject({ href: "blob:test-url", download: "resultat.png" });
    expect(liens[0]!.click).toHaveBeenCalledOnce();
    expect(liens[0]!.remove).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test-url");
  });
});
