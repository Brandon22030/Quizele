import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { createAuth } from "../../../server/auth/auth";

export const prerender = false;

export const ALL: APIRoute = ({ request }) => createAuth(env, request).handler(request);
