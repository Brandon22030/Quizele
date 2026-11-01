import { env } from "cloudflare:workers";
import { vi } from "vitest";
import { createAuth, type AuthEnv } from "../../../src/server/auth/auth";

export const ORIGIN = "http://localhost:4321";
export const authEnv = (overrides: Partial<AuthEnv> = {}): AuthEnv => ({ ...env, ...overrides }) as AuthEnv;

let ipCounter = 0;
// Chaque appel reçoit une IP distincte : la limite par IP de Better Auth ne doit pas masquer ce que l'on teste.
export const freshIp = () => `192.0.2.${++ipCounter}`;

export function authFetch(path: string, init: RequestInit = {}, overrides: Partial<AuthEnv> = {}) {
  const headers = new Headers(init.headers);
  headers.set("origin", ORIGIN);
  if (!headers.has("cf-connecting-ip")) headers.set("cf-connecting-ip", freshIp());
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const request = new Request(`${ORIGIN}${path}`, { ...init, headers, redirect: "manual" });
  return createAuth(authEnv(overrides), request).handler(request);
}

export const requestMagicLink = (email: string, headers: HeadersInit = {}, overrides: Partial<AuthEnv> = {}) =>
  authFetch(
    "/api/auth/sign-in/magic-link",
    { method: "POST", headers, body: JSON.stringify({ email, callbackURL: "/tableau-de-bord" }) },
    overrides,
  );

// Capture le lien écrit par le transport console.
export function captureConsoleMail() {
  const spy = vi.spyOn(console, "info").mockImplementation(() => {});
  return {
    spy,
    link: () => {
      const text = spy.mock.calls.map((c) => String(c[0])).join("\n");
      const match = text.match(/https?:\/\/\S+/);
      if (!match) throw new Error("Aucun lien capturé par le transport console.");
      return match[0];
    },
  };
}

export const sessionCookie = (res: Response) => {
  const cookies = res.headers.getSetCookie().filter((c) => c.includes("session_token"));
  return cookies.map((c) => c.split(";")[0]).join("; ");
};

export const RESEND_ENV = { MAIL_TRANSPORT: "resend", RESEND_API_KEY: "re_factice", MAIL_FROM: "Quizdeszeles <onboarding@resend.dev>" };

// En https le transport console est interdit : on capture alors le lien dans l'appel simulé à l'API Resend.
export function captureResendMail() {
  const realFetch = globalThis.fetch;
  const bodies: string[] = [];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.includes("api.resend.com")) return realFetch(input, init);
    bodies.push(String((init as RequestInit | undefined)?.body ?? ""));
    return Response.json({ id: `e${bodies.length}` });
  });
  const text = () => bodies.map((b) => (JSON.parse(b) as { text: string }).text).join("\n");
  return {
    spy,
    bodies,
    text,
    link: () => {
      const match = text().match(/https?:\/\/\S+/);
      if (!match) throw new Error("Aucun lien capturé dans l'appel Resend.");
      return match[0];
    },
  };
}
