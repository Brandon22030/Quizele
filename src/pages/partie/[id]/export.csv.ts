import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { construireCsv, nomFichier } from "../../../islands/bilan/csv";
import { construireDonnees } from "../../../islands/bilan/logique";
import { getDb } from "../../../server/db/client";
import { getSessionReport } from "../../../server/db/results";

export const prerender = false;

const PRIVE = { "Cache-Control": "private, no-store" };

// Partie absente, purgée ou d'un autre animateur : même 404, sans rien révéler de son existence.
const introuvable = () => new Response("Bilan introuvable.", { status: 404, headers: { ...PRIVE, "Content-Type": "text/plain; charset=utf-8" } });

export const GET: APIRoute = async ({ locals, params }) => {
  const user = locals.user;
  const sessionId = params.id ?? "";
  if (!user || !sessionId) return introuvable();

  let rapport: Awaited<ReturnType<typeof getSessionReport>>;
  try {
    rapport = await getSessionReport(getDb(env.DB), user.id, sessionId);
  } catch {
    return new Response("Export indisponible.", { status: 500, headers: { ...PRIVE, "Content-Type": "text/plain; charset=utf-8" } });
  }
  if (!rapport) return introuvable();
  // Pas d'export avant la fin : les lignes de résultats n'existent pas encore. Le propriétaire connaît déjà la partie,
  // un 409 ne révèle rien à un tiers (le filtre de propriété a déjà renvoyé la 404 uniforme).
  if (rapport.session.status !== "ended") {
    return new Response("La partie n'est pas terminée.", { status: 409, headers: { ...PRIVE, "Content-Type": "text/plain; charset=utf-8" } });
  }

  const donnees = construireDonnees(rapport.session, rapport.players, rapport.stats);
  return new Response(construireCsv(donnees.joueurs, donnees.total), {
    headers: {
      ...PRIVE,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nomFichier(donnees.quizTitle, new Date(donnees.jouee))}"`,
    },
  });
};
