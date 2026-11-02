import { describe, expect, it } from "vitest";
import { retourBrut, validerEmail } from "../../../src/islands/connexion/logique";
import { safeReturnPath } from "../../../src/server/auth/routes";

const origine = "https://quiz.example";
const repli = "/tableau-de-bord";

describe("retour : redirections ouvertes, chaîne complète (retourBrut puis safeReturnPath)", () => {
  it.each([
    "?retour=%2F%5Cevil.example",
    "?retour=%2F%5C%5Cevil.example",
    "?retour=%2F%2F%2Fevil.example",
    "?retour=https%3A%2F%2Fevil.example",
    "?retour=HTTPS%3A%2F%2Fevil.example",
    "?retour=%2Fquiz%2F..%2F..%2Fevil",
    "?retour=%2Fquiz%2F%252e%252e%2Fevil",
    "?retour=%2Fquiz%0d%0aLocation%3A%20https%3A%2F%2Fevil.example",
    "?retour=%2Fquiz%00",
    "?retour=%E0%A4%A",
    "?retour=",
    "?retour",
    `?retour=${encodeURIComponent(`/quiz/${"a".repeat(600)}`)}`,
    "?retour=%2Fconnexion",
    "?retour=%2Fj%2FABC234",
    "?retour=%2F",
    "?retour=data%3Atext%2Fhtml%2C%3Cscript%3E",
    "?retour=%2Fquiz%40evil.example",
  ])("%s retombe sur /tableau-de-bord", (search) => {
    expect(safeReturnPath(retourBrut(search), origine)).toBe(repli);
  });

  it("un retour valide est respecté, même au milieu d'autres paramètres, le premier `retour` l'emporte", () => {
    expect(safeReturnPath(retourBrut("?error=x&retour=%2Fquiz%2Fx"), origine)).toBe("/quiz/x");
    expect(safeReturnPath(retourBrut("?retour=%2Fquiz%2Fx&retour=https%3A%2F%2Fevil.example"), origine)).toBe("/quiz/x");
    expect(safeReturnPath(retourBrut("?retour=%2Fpartie%2Fabc%2Fanimer"), origine)).toBe("/partie/abc/animer");
    expect(safeReturnPath(retourBrut("?retour=%2Ftableau-de-bord"), origine)).toBe("/tableau-de-bord");
  });

  it("un paramètre voisin dont le nom finit par `retour` n'est pas confondu", () => {
    expect(retourBrut("?xretour=%2Fquiz%2Fx")).toBeNull();
  });
});

describe("validerEmail : cas limites", () => {
  it.each(["", "   ", "a", "a@", "@b.fr", "a@b", "a b@c.fr", "a@b..fr", "a@.fr", "a@b.fr extra", "a@@b.fr", `${"a".repeat(250)}@b.fr`])(
    "refuse %j",
    (saisie) => {
      expect(validerEmail(saisie).ok).toBe(false);
    },
  );

  it.each(["a@b.fr", " A@B.FR ", "pre.nom+tag@sous.domaine.example", "é@b.fr"])("accepte %j", (saisie) => {
    expect(validerEmail(saisie).ok).toBe(true);
  });

  it("254 caractères exactement : accepté ; 255 : refusé", () => {
    const local = "a".repeat(254 - "@b.fr".length);
    expect(validerEmail(`${local}@b.fr`).ok).toBe(true);
    expect(validerEmail(`a${local}@b.fr`).ok).toBe(false);
  });
});
