import { expect, test } from "@playwright/test";

// baseURL par défaut : build de production (wrangler dev sur dist), où import.meta.env.DEV est faux.
test("le guide de style répond 404 hors développement", async ({ request }) => {
  const reponse = await request.get("/dev/styleguide-base");
  expect(reponse.status()).toBe(404);
  expect(await reponse.text()).not.toContain("Guide de style");
});
