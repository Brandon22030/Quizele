import { WS_SUBPROTOCOL } from "../../shared/protocol";

// Un refus HTTP pendant la poignée de main n'arrive au navigateur que comme une fermeture 1006 anonyme, et le client
// se reconnecterait sans fin. On accepte donc le socket pour le refermer aussitôt avec un code que le client comprend.
export function closedSocket(code: number, reason: string): Response {
  const pair = new WebSocketPair();
  const [client, server] = [pair[0], pair[1]];
  server.accept();
  server.close(code, reason);
  return new Response(null, { status: 101, webSocket: client, headers: { "Sec-WebSocket-Protocol": WS_SUBPROTOCOL } });
}
