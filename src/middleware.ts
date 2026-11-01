import { env } from "cloudflare:workers";
import { defineMiddleware } from "astro:middleware";
import { getSessionUser } from "./server/auth/session";
import { isProtectedPath, loginRedirectUrl } from "./server/auth/routes";

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, url } = context;
  context.locals.user = await getSessionUser(env, request);
  if (!context.locals.user && isProtectedPath(url.pathname)) {
    return context.redirect(loginRedirectUrl(url));
  }
  return next();
});
