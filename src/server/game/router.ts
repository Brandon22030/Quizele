// Routage /ws/:code vers le Durable Object : implémenté en QZ-002-02.
export async function routeWebSocket(_request: Request, _env: Env): Promise<Response> {
  return new Response("Temps réel non implémenté", { status: 501 });
}
