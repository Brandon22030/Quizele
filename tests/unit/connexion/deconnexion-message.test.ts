import { describe, expect, it } from "vitest";
import { messageErreurRedirection } from "../../../src/islands/connexion/logique";

describe("messageErreurRedirection : déconnexion non confirmée", () => {
  it("explique que la déconnexion n'a pas pu être confirmée", () => {
    const message = "La déconnexion n'a pas pu être confirmée. Reconnecte-toi ou réessaie.";
    expect(messageErreurRedirection("deconnexion")).toBe(message);
    expect(messageErreurRedirection("DECONNEXION")).toBe(message);
    expect(messageErreurRedirection("autre")).not.toBe(message);
  });
});
