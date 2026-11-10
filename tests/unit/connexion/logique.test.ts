import { describe, expect, it, vi } from "vitest";
import {
  demanderLienMagique,
  demanderUrlGoogle,
  messageDepuisStatut,
  lireEmail,
  lireEnvoi,
  masquerEmail,
  memoriserEnvoi,
  messageErreurRedirection,
  secondesRestantes,
  MESSAGE_TROP_DE_DEMANDES,
  retourBrut,
  urlErreurConnexion,
  urlVerification,
  validerEmail,
} from "../../../src/islands/connexion/logique";
import { safeReturnPath } from "../../../src/server/auth/routes";

const origine = "https://quiz.example";

describe("validerEmail", () => {
  it("accepte une adresse valide et la nettoie", () => {
    expect(validerEmail("  esther@exemple.fr ")).toEqual({ ok: true, email: "esther@exemple.fr" });
  });

  it.each(["", "   ", "esther", "esther@", "@exemple.fr", "esther@exemple", "es ther@exemple.fr", "a@b@c.fr", "a@exemple..fr"])(
    "refuse %j avec un message en français",
    (saisie) => {
      const resultat = validerEmail(saisie);
      expect(resultat.ok).toBe(false);
      if (!resultat.ok) expect(resultat.message).toMatch(/e-mail/);
    },
  );

  it("refuse une adresse de plus de 254 caractères", () => {
    expect(validerEmail(`${"a".repeat(250)}@exemple.fr`).ok).toBe(false);
  });
});

describe("retour", () => {
  it("lit la valeur brute puis safeReturnPath l'accepte une seule fois décodée", () => {
    const brut = retourBrut("?retour=%2Fquiz%2Fa%3Fx%3D1&error=INVALID_TOKEN");
    expect(brut).toBe("%2Fquiz%2Fa%3Fx%3D1");
    expect(safeReturnPath(brut, origine)).toBe("/quiz/a?x=1");
  });

  it.each([
    "?retour=https%3A%2F%2Fevil.example%2Fquiz",
    "?retour=%2F%2Fevil.example",
    "?retour=%252F%252Fevil.example",
    "?retour=%2Fapi%2Fauth%2Fsign-out",
    "?retour=%5C%5Cevil.example",
    "?retour=javascript%3Aalert(1)",
  ])("un retour externe ou détourné (%s) retombe sur le tableau de bord", (search) => {
    expect(safeReturnPath(retourBrut(search), origine)).toBe("/tableau-de-bord");
  });

  it("sans paramètre, retombe sur le tableau de bord", () => {
    expect(retourBrut("")).toBeNull();
    expect(safeReturnPath(retourBrut("?error=x"), origine)).toBe("/tableau-de-bord");
  });

  it("les URL construites encodent le retour et l'adresse", () => {
    expect(urlErreurConnexion("/quiz/a?x=1")).toBe("/connexion?retour=%2Fquiz%2Fa%3Fx%3D1");
    expect(urlVerification("/quiz/a")).toBe("/connexion/verifier?retour=%2Fquiz%2Fa");
  });
});

describe("messages d'erreur", () => {
  it("lien expiré ou déjà utilisé", () => {
    expect(messageErreurRedirection("INVALID_TOKEN")).toBe("Ce lien a expiré ou a déjà servi. Demande-en un nouveau.");
    expect(messageErreurRedirection("expired_token")).toBe(messageErreurRedirection("INVALID_TOKEN"));
  });

  it("refus Google et codes inconnus", () => {
    expect(messageErreurRedirection("access_denied")).toMatch(/Google/);
    expect(messageErreurRedirection("failed_to_create_session")).toMatch(/échoué/);
  });

  it("état OAuth perdu : message français dédié", () => {
    for (const code of ["state_mismatch", "state_not_found"]) {
      expect(messageErreurRedirection(code)).toMatch(/Google.*(expiré|interrompue)/);
    }
  });

  it("aucun message sans code", () => {
    expect(messageErreurRedirection(null)).toBeNull();
    expect(messageErreurRedirection("")).toBeNull();
  });

  it("le 429 est neutre : aucune mention de plafond quotidien", () => {
    expect(messageDepuisStatut(429)).toBe(MESSAGE_TROP_DE_DEMANDES);
    expect(MESSAGE_TROP_DE_DEMANDES).toBe("Trop de demandes, réessaie dans une minute.");
    expect(MESSAGE_TROP_DE_DEMANDES).not.toMatch(/jour|quotidien|plafond/i);
  });

  it("400 et autres statuts", () => {
    expect(messageDepuisStatut(400)).toMatch(/e-mail/);
    expect(messageDepuisStatut(500)).toMatch(/Réessaie/);
  });
});

describe("appels Better Auth", () => {
  it("le lien magique part en JSON avec le callbackURL fourni", async () => {
    const appel = vi.fn(async () => new Response("{}", { status: 200 }));
    const resultat = await demanderLienMagique("a@exemple.fr", "/quiz/a", appel as unknown as typeof fetch);
    expect(resultat.ok).toBe(true);
    const [chemin, init] = appel.mock.calls[0] as unknown as [string, RequestInit];
    expect(chemin).toBe("/api/auth/sign-in/magic-link");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({
      email: "a@exemple.fr",
      callbackURL: "/quiz/a",
      errorCallbackURL: "/connexion?retour=%2Fquiz%2Fa",
    });
  });

  it("un 429 donne le message neutre", async () => {
    const appel = async () => new Response("{}", { status: 429 });
    expect(await demanderLienMagique("a@exemple.fr", "/quiz/a", appel as unknown as typeof fetch)).toEqual({
      ok: false,
      message: MESSAGE_TROP_DE_DEMANDES,
    });
  });

  it("un réseau coupé donne un message d'échec", async () => {
    const appel = async () => {
      throw new TypeError("réseau");
    };
    const resultat = await demanderLienMagique("a@exemple.fr", "/quiz/a", appel as unknown as typeof fetch);
    expect(resultat.ok).toBe(false);
  });

  it("Google renvoie l'URL de redirection ou un échec explicite", async () => {
    const bon = async () => Response.json({ url: "https://accounts.google.com/x", redirect: true });
    expect(await demanderUrlGoogle("/quiz/a", bon as unknown as typeof fetch)).toEqual({ ok: true, donnees: "https://accounts.google.com/x" });
    const vide = async () => Response.json({});
    expect((await demanderUrlGoogle("/quiz/a", vide as unknown as typeof fetch)).ok).toBe(false);
    const refus = async () => new Response("{}", { status: 500 });
    expect((await demanderUrlGoogle("/quiz/a", refus as unknown as typeof fetch)).ok).toBe(false);
  });
});

describe("confirmation d'envoi : stockage et décompte", () => {
  const faux = () => {
    const données = new Map<string, string>();
    return { getItem: (k: string) => données.get(k) ?? null, setItem: (k: string, v: string) => void données.set(k, v) };
  };

  it("masque l'adresse sans la perdre", () => {
    expect(masquerEmail("brandon@gmail.com")).toBe("b***@gmail.com");
    expect(masquerEmail("a@b.fr")).toBe("a***@b.fr");
    expect(masquerEmail("pas-une-adresse")).toBe("***");
  });

  it("mémorise l'adresse et l'horodatage, et les relit", () => {
    const stockage = faux();
    memoriserEnvoi(stockage, 1234, "a@exemple.fr");
    expect(lireEmail(stockage)).toBe("a@exemple.fr");
    expect(lireEnvoi(stockage)).toBe(1234);
  });

  it("un renvoi met à jour l'horodatage sans toucher à l'adresse", () => {
    const stockage = faux();
    memoriserEnvoi(stockage, 1, "a@exemple.fr");
    memoriserEnvoi(stockage, 99);
    expect(lireEmail(stockage)).toBe("a@exemple.fr");
    expect(lireEnvoi(stockage)).toBe(99);
  });

  it("ignore une adresse corrompue ou un horodatage illisible", () => {
    const stockage = faux();
    stockage.setItem("quizdeszeles:connexion-email", "<img src=x>@exemple.fr");
    stockage.setItem("quizdeszeles:connexion-envoi", "abc");
    expect(lireEmail(stockage)).toBeNull();
    expect(lireEnvoi(stockage)).toBeNull();
  });

  it("un stockage indisponible ne casse rien", () => {
    const casse = {
      getItem: () => {
        throw new Error("indisponible");
      },
      setItem: () => {
        throw new Error("indisponible");
      },
    };
    expect(() => memoriserEnvoi(casse, 1, "a@exemple.fr")).not.toThrow();
    expect(lireEmail(casse)).toBeNull();
    expect(lireEnvoi(casse)).toBeNull();
  });

  it("calcule le délai restant, borné entre 0 et 60 s", () => {
    expect(secondesRestantes(0, 0)).toBe(60);
    expect(secondesRestantes(0, 20_500)).toBe(40);
    expect(secondesRestantes(0, 60_000)).toBe(0);
    expect(secondesRestantes(0, 600_000)).toBe(0);
    expect(secondesRestantes(10_000, 0)).toBe(60);
  });
});
