import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { signOutResponse } from "../server/auth/sign-out";

export const prerender = false;

export const POST: APIRoute = ({ request }) => signOutResponse(env, request);

// Une déconnexion par GET serait déclenchable par un préchargement ou une simple image.
export const ALL: APIRoute = () => new Response(null, { status: 405, headers: { allow: "POST" } });
