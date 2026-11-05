import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameSocket, MAX_FAILED_ATTEMPTS, MAX_FAILED_ATTEMPTS_AFTER_OPEN, terminalStatusFor, type ConnectionStatus } from "../../src/client/realtime/game-socket";

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
  vi.stubGlobal("navigator", { onLine: true });
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

describe("GameSocket : refus HTTP répétés (rotation du secret)", () => {
  // Avance l'horloge simulée jusqu'à la prochaine tentative, borne comprise en temps simulé : un vi.waitFor serait borné
  // en temps réel et échouerait sur une machine chargée.
  async function nextInstance(): Promise<FakeWebSocket> {
    const before = FakeWebSocket.instances.length;
    for (let step = 0; step < 40 && FakeWebSocket.instances.length === before; step += 1) await vi.advanceTimersByTimeAsync(500);
    expect(FakeWebSocket.instances.length).toBeGreaterThan(before);
    return FakeWebSocket.instances.at(-1)!;
  }

  // Chaque tentative échoue avant ouverture, comme un 401 vu par le navigateur (1006).
  async function failNextAttempt(): Promise<void> {
    (await nextInstance()).serverClose(1006);
  }

  it(`passe à "rejected" après ${MAX_FAILED_ATTEMPTS} échecs sans jamais avoir ouvert, puis ne retente plus`, async () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i += 1) await failNextAttempt();
    expect(statuses.at(-1)).toBe("connecting");
    await failNextAttempt();
    expect(statuses.at(-1)).toBe("rejected");
    const attempts = FakeWebSocket.instances.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(FakeWebSocket.instances).toHaveLength(attempts);
  });

  it("hors ligne, les échecs ne comptent pas", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    for (let i = 0; i < MAX_FAILED_ATTEMPTS + 2; i += 1) await failNextAttempt();
    expect(statuses).not.toContain("rejected");
  });

  it("une fois le socket ouvert, les coupures suivantes ne mènent jamais à \"rejected\"", async () => {
    await firstSocket();
    FakeWebSocket.instances[0]!.serverClose(1006);
    for (let i = 0; i < MAX_FAILED_ATTEMPTS + 2; i += 1) await failNextAttempt();
    expect(statuses).not.toContain("rejected");
    expect(statuses.at(-1)).toBe("reconnecting");
  });

  it(`après une ouverture, abandonne à ${MAX_FAILED_ATTEMPTS_AFTER_OPEN} échecs consécutifs et pas avant`, async () => {
    await firstSocket();
    FakeWebSocket.instances[0]!.serverClose(1006);
    for (let i = 0; i < MAX_FAILED_ATTEMPTS_AFTER_OPEN - 2; i += 1) await failNextAttempt();
    expect(statuses).not.toContain("rejected");
    await failNextAttempt();
    expect(statuses.at(-1)).toBe("rejected");
  });

  it("le compteur repart de zéro à chaque ouverture réussie", async () => {
    await firstSocket();
    FakeWebSocket.instances[0]!.serverClose(1006);
    for (let round = 0; round < 3; round += 1) {
      for (let i = 0; i < MAX_FAILED_ATTEMPTS_AFTER_OPEN - 2; i += 1) await failNextAttempt();
      // Une ouverture réussie, aussitôt perdue : les échecs précédents ne comptent plus.
      const attempt = await nextInstance();
      attempt.open();
      attempt.serverClose(1006);
    }
    expect(statuses).not.toContain("rejected");
  });
});

describe("GameSocket : poignée de main lente (serveur ou réseau chargé)", () => {
  // Chaque nouvelle tentative n'ouvre qu'au bout de `delaiMs` : un serveur saturé met plusieurs secondes à répondre 101.
  function poigneesLentes(delaiMs: number): void {
    const original = FakeWebSocket.instances.push.bind(FakeWebSocket.instances);
    FakeWebSocket.instances.push = (...sockets: FakeWebSocket[]) => {
      for (const ws of sockets) setTimeout(() => ws.readyState === FakeWebSocket.CONNECTING && ws.open(), delaiMs);
      return original(...sockets);
    };
  }

  it("après une coupure, une reprise dont la poignée de main dure 6 s finit par aboutir", async () => {
    await firstSocket();
    poigneesLentes(6_000);
    FakeWebSocket.instances[0]!.serverClose(1006);
    expect(statuses.at(-1)).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(statuses.at(-1)).toBe("open");
  });

  it("au premier chargement, une poignée de main de 6 s aboutit au lieu de mener à \"rejected\"", async () => {
    poigneesLentes(6_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(statuses).not.toContain("rejected");
    expect(statuses.at(-1)).toBe("open");
  });

  it("une poignée de main de plus de 12 s reste abandonnée : le délai est borné", async () => {
    poigneesLentes(14_000);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(statuses).not.toContain("open");
    expect(statuses.at(-1)).toBe("rejected");
  });
});
