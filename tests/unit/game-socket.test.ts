import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameSocket, terminalStatusFor, type ConnectionStatus } from "../../src/client/realtime/game-socket";

class FakeWebSocket extends EventTarget {
  static instances: FakeWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState = 0;
  binaryType = "blob";
  constructor(readonly url: string, readonly protocols?: string | string[]) {
    super();
    FakeWebSocket.instances.push(this);
  }
  send(): void {}
  open(): void {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }
  close(code = 1000, reason = ""): void {
    if (this.readyState === 3) return;
    this.serverClose(code, reason);
  }
  serverClose(code: number, reason = ""): void {
    this.readyState = 3;
    this.dispatchEvent(new CloseEvent("close", { code, reason }));
  }
}

let statuses: ConnectionStatus[];
let socket: GameSocket | null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("document", { addEventListener: () => {}, removeEventListener: () => {}, visibilityState: "visible" });
  vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
  FakeWebSocket.instances = [];
  statuses = [];
  socket = new GameSocket({
    code: "ABC123",
    baseUrl: "ws://exemple.test",
    getToken: () => "jeton",
    onMessage: () => {},
    onStatus: (status) => statuses.push(status),
    WebSocket: FakeWebSocket as unknown as typeof WebSocket,
  });
});

afterEach(() => {
  socket?.close();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function firstSocket(): Promise<FakeWebSocket> {
  await vi.advanceTimersByTimeAsync(1_000);
  const ws = FakeWebSocket.instances[0]!;
  ws.open();
  return ws;
}

describe("GameSocket : fermetures définitives", () => {
  it.each([
    [4003, "kicked"],
    [4004, "ended"],
    [4001, "rejected"],
    [4002, "rejected"],
  ] as const)("sur %i, passe au statut %s et ne se reconnecte plus", async (code, expected) => {
    const ws = await firstSocket();
    ws.serverClose(code);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(statuses.at(-1)).toBe(expected);
  });

  it("sur une coupure ordinaire (1006) ou un dépassement de débit (1008), se reconnecte", async () => {
    const ws = await firstSocket();
    ws.serverClose(1008);
    expect(statuses.at(-1)).toBe("reconnecting");
    // Moins que le délai de connexion de partysocket (4 s), au-delà duquel une tentative non ouverte est relancée.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    FakeWebSocket.instances[1]!.open();
    FakeWebSocket.instances[1]!.serverClose(1006);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it("terminalStatusFor ne traite comme définitifs que les codes applicatifs 4001 à 4004", () => {
    expect([1000, 1001, 1006, 1008, 1009, 4000, 4005].map(terminalStatusFor)).toEqual([null, null, null, null, null, null, null]);
  });
});
