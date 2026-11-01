// Test de charge local : 50 joueurs simulés contre `wrangler dev` (bundle dist/server).
// Usage : npm run build && npm run test:charge   (options : --parties=N, --joueurs=N, --sans-pause)
// Aucun appel distant : le serveur écoute sur localhost et le secret est la valeur factice de wrangler.jsonc.
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { once } from "node:events";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, v ?? true]));
const PARTIES = Number(args.parties ?? 3);
const JOUEURS = Number(args.joueurs ?? 50);
const PAUSE_HIBERNATION_MS = args["sans-pause"] ? 0 : 12_000;
const PORT = Number(process.env.CHARGE_PORT ?? 4330);
const BASE = process.env.CHARGE_URL ?? `http://localhost:${PORT}`;
const CONFIG = "dist/server/wrangler.json";

const encoder = new TextEncoder();
const b64url = (bytes) => Buffer.from(bytes).toString("base64url");

async function signToken(secret, claims) {
  const payload = b64url(encoder.encode(JSON.stringify({ c: claims.code, s: claims.sid, r: claims.role, p: claims.playerId, e: Date.now() + 3_600_000 })));
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return `${payload}.${b64url(new Uint8Array(signature))}`;
}

const SUBPROTOCOL = "quizdeszeles.v1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return { n: sorted.length, mediane: at(0.5), p95: at(0.95), max: sorted.at(-1) };
};
const fmt = (s) => `n=${s.n} médiane=${s.mediane.toFixed(1)} ms, p95=${s.p95.toFixed(1)} ms, max=${s.max.toFixed(1)} ms`;

class Client {
  constructor(url, token) {
    this.messages = [];
    this.raw = [];
    this.waiters = [];
    this.sent = 0;
    // Le jeton voyage dans Sec-WebSocket-Protocol, pas dans l'URL.
    this.ws = new WebSocket(url, [SUBPROTOCOL, token]);
    this.ws.addEventListener("message", (event) => {
      if (event.data === "pong") return;
      const at = performance.now();
      const message = JSON.parse(event.data);
      this.raw.push(event.data);
      this.messages.push({ message, at });
      for (const w of [...this.waiters]) w();
    });
    this.opened = new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", () => reject(new Error(`connexion refusée : ${url}`)), { once: true });
    });
  }
  send(message) {
    this.sent += 1;
    this.ws.send(JSON.stringify(message));
  }
  waitFor(predicate, timeoutMs = 20_000) {
    const find = () => this.messages.find((m) => predicate(m.message));
    return new Promise((resolve, reject) => {
      const found = find();
      if (found) return resolve(found);
      const timer = setTimeout(() => reject(new Error("délai dépassé")), timeoutMs);
      const waiter = () => {
        const m = find();
        if (!m) return;
        clearTimeout(timer);
        this.waiters = this.waiters.filter((w) => w !== waiter);
        resolve(m);
      };
      this.waiters.push(waiter);
    });
  }
  close() {
    this.ws.close();
  }
}

function descendants(rootPid) {
  const lines = execFileSync("ps", ["-A", "-o", "pid=,ppid=,time=,command="], { encoding: "utf8" }).split("\n").filter(Boolean);
  const procs = lines.map((l) => {
    const [pid, ppid, time, ...cmd] = l.trim().split(/\s+/);
    return { pid: Number(pid), ppid: Number(ppid), time, cmd: cmd.join(" ") };
  });
  const found = new Set([rootPid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of procs) {
      if (found.has(p.pid) || !found.has(p.ppid)) continue;
      found.add(p.pid);
      grew = true;
    }
  }
  return procs.filter((p) => found.has(p.pid));
}
const cpuSeconds = (time) => time.split(":").reduce((acc, part) => acc * 60 + Number(part), 0);
// Temps CPU cumulé des processus workerd lancés par ce wrangler (précision du centième de seconde).
function workerdCpu(rootPid) {
  return descendants(rootPid).filter((p) => p.cmd.includes("workerd")).reduce((sum, p) => sum + cpuSeconds(p.time), 0);
}

async function startServer() {
  if (process.env.CHARGE_URL) return { pid: null, stop: () => {} };
  if (!existsSync(CONFIG)) throw new Error("dist/server/wrangler.json absent : lancer `npm run build` d'abord.");
  const child = spawn("npx", ["wrangler", "dev", "--config", CONFIG, "--port", String(PORT), "--local"], { stdio: ["ignore", "pipe", "pipe"], detached: false });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const res = await fetch(`${BASE}/`);
      if (res.status > 0) break;
    } catch {
      if (Date.now() > deadline) throw new Error(`wrangler dev ne répond pas :\n${log}`);
      await sleep(300);
    }
  }
  return {
    pid: child.pid,
    stop: async () => {
      // Arrêt par PID de notre propre arbre uniquement : d'autres projets font tourner des workerd.
      for (const p of descendants(child.pid).reverse()) {
        try { process.kill(p.pid, "SIGTERM"); } catch { /* déjà arrêté */ }
      }
      await Promise.race([once(child, "exit"), sleep(5000)]);
    },
  };
}

const secret = JSON.parse(readFileSync(CONFIG, "utf8")).vars?.PLAYER_TOKEN_SECRET;
if (!secret) throw new Error("PLAYER_TOKEN_SECRET absent de dist/server/wrangler.json");
const wsBase = BASE.replace(/^http/, "ws");
const connectTo = async (code, token) => {
  const client = new Client(`${wsBase}/ws/${code}`, token);
  await client.opened;
  client.send({ type: "resume" });
  await client.waitFor((m) => m.type === "snapshot");
  return client;
};

const FORBIDDEN = /correct|explanation|reference/i;
const QUIZ = [
  { id: "q1", good: ["q1b"], bad: ["q1a"] },
  { id: "q2", good: ["q2a", "q2c"], bad: ["q2a"] },
  { id: "q3", good: ["q3b"], bad: ["q3a"] },
];

async function playGame(index, report, pid) {
  const cpu = () => (pid ? workerdCpu(pid) : 0);
  const code = `L${Date.now().toString(36).slice(-4).toUpperCase()}${index}`.slice(0, 6).padEnd(6, "0");
  const host = await connectTo(code, await signToken(secret, { code, sid: crypto.randomUUID(), role: "host" }));

  const cpuStart = cpu();
  const t0 = performance.now();
  const players = [];
  await Promise.all(
    Array.from({ length: JOUEURS }, async (_, i) => {
      const res = await fetch(`${BASE}/api/parties/${code}/joueurs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pseudo: `J${i}` }) });
      if (res.status !== 201) throw new Error(`inscription refusée (${res.status})`);
      const { playerId, token } = await res.json();
      players[i] = { client: await connectTo(code, token), playerId, token };
    }),
  );
  report.joinMs.push(performance.now() - t0);
  const cpuJoined = cpu();
  report.cpuJoin += cpuJoined - cpuStart;
  const incomingJoined = host.sent + players.reduce((n, p) => n + p.client.sent, 0);
  let cpuPause = 0;

  let leaks = 0;
  let totalAnswers = 0;
  for (const [qi, q] of QUIZ.entries()) {
    const marks = players.map((p) => p.client.messages.length);
    const tStart = performance.now();
    host.send({ type: qi === 0 ? "start" : "next" });
    const received = await Promise.all(players.map((p) => p.client.waitFor((m) => m.type === "question" && m.questionId === q.id)));
    report.question.push(...received.map((m) => m.at - tStart));
    if (received.some((m) => m.message.serverNow < m.message.startedAt)) throw new Error("serverNow incohérent");

    const tAnswer = performance.now();
    players.forEach((p, i) => p.client.send({ type: "answer", questionId: q.id, optionIds: i % 2 === 0 ? q.good : q.bad }));
    const acks = await Promise.all(players.map((p) => p.client.waitFor((m) => m.type === "answer_ack" && m.questionId === q.id)));
    report.ack.push(...acks.map((m) => m.at - tAnswer));
    if (acks.some((m) => m.message.duplicate || m.message.late)) throw new Error("ack inattendu");
    const counted = await host.waitFor((m) => m.type === "answer_count" && m.questionId === q.id && m.count === JOUEURS);
    report.count.push(counted.at - tAnswer);
    totalAnswers += JOUEURS;

    // Réponse en double : ne doit pas être recomptée.
    players[0].client.send({ type: "answer", questionId: q.id, optionIds: q.bad });
    await players[0].client.waitFor((m) => m.type === "answer_ack" && m.questionId === q.id && m.duplicate);

    for (const [i, p] of players.entries()) leaks += p.client.raw.slice(marks[i]).filter((raw) => FORBIDDEN.test(raw)).length;

    const cpuBeforeReveal = cpu();
    const tReveal = performance.now();
    host.send({ type: "reveal" });
    const reveals = await Promise.all(players.map((p) => p.client.waitFor((m) => m.type === "reveal" && m.questionId === q.id)));
    report.reveal.push(...reveals.map((m) => m.at - tReveal));
    report.cpuReveal += cpu() - cpuBeforeReveal;
    report.reveals += 1;

    if (qi === 0) {
      // Reconnexion de 10 joueurs : instantané complet attendu, réponse déjà comptée.
      for (const [i, p] of players.slice(0, 10).entries()) {
        p.client.close();
        p.client = await connectTo(code, p.token);
        const snap = p.client.messages.find((m) => m.message.type === "snapshot").message;
        if (snap.phase !== "revealed" || snap.me?.score !== (i % 2 === 0 ? 1 : 0) || !snap.me?.answered) throw new Error(`reprise incohérente : ${JSON.stringify(snap.me)}`);
        report.reconnected += 1;
      }
      if (PAUSE_HIBERNATION_MS && index === 0) {
        report.hibernationPauseMs = PAUSE_HIBERNATION_MS;
        const before = cpu();
        await sleep(PAUSE_HIBERNATION_MS);
        cpuPause = cpu() - before;
      }
    }
  }
  host.send({ type: "next" });
  const finals = await Promise.all(players.map((p) => p.client.waitFor((m) => m.type === "finished")));
  const ranking = finals[0].message.ranking;
  // Joueurs pairs : 3 bonnes réponses ; impairs : 0 (la mauvaise réponse du choix multiple est fausse aussi).
  const expectedTop = ranking.filter((r) => r.score === 3).length;
  if (ranking.length !== JOUEURS || expectedTop !== JOUEURS / 2) throw new Error(`classement faux : ${expectedTop} joueurs à 3 points`);
  report.cpuPlay += cpu() - cpuJoined - cpuPause;
  report.cpuPause += cpuPause;
  report.incomingPlay += host.sent + players.reduce((n, p) => n + p.client.sent, 0) - incomingJoined;
  report.leaks += leaks;
  report.answers += totalAnswers;
  [host, ...players.map((p) => p.client)].forEach((c) => c.close());
}

const server = await startServer();
const report = { joinMs: [], question: [], ack: [], count: [], reveal: [], reconnected: 0, cpuJoin: 0, cpuReveal: 0, reveals: 0, cpuPlay: 0, cpuPause: 0, incomingPlay: 0, leaks: 0, answers: 0, hibernationPauseMs: 0 };
let exitCode = 0;
try {
  // Les parties successives chauffent le Worker : la première est comptée à part dans la sortie.
  if (server.pid) await sleep(1500);
  const cpuBefore = server.pid ? workerdCpu(server.pid) : null;
  const wallStart = performance.now();
  for (let i = 0; i < PARTIES; i += 1) await playGame(i, report, server.pid);
  const wallMs = performance.now() - wallStart;
  const cpuAfter = server.pid ? workerdCpu(server.pid) : null;

  console.log(`Parties : ${PARTIES} x ${JOUEURS} joueurs, ${QUIZ.length} questions, ${report.answers} réponses comptées, ${report.reconnected} reprises, fuites de correction : ${report.leaks}`);
  console.log(`Inscription + connexion de ${JOUEURS} joueurs : ${fmt(stats(report.joinMs))}`);
  console.log(`Diffusion de la question (hôte -> ${JOUEURS} joueurs) : ${fmt(stats(report.question))}`);
  console.log(`Accusé de réception de ${JOUEURS} réponses simultanées : ${fmt(stats(report.ack))}`);
  console.log(`Compteur hôte à ${JOUEURS} réponses : ${fmt(stats(report.count))}`);
  console.log(`Diffusion de la révélation : ${fmt(stats(report.reveal))}`);
  if (cpuBefore !== null) {
    const ms = (seconds) => (seconds * 1000).toFixed(0);
    console.log(`Durée totale : ${(wallMs / 1000).toFixed(1)} s ; CPU workerd total : ${ms(cpuAfter - cpuBefore)} ms`);
    console.log(`CPU inscriptions + connexions (${PARTIES * JOUEURS} HTTP + WebSocket) : ${ms(report.cpuJoin)} ms, soit ${(report.cpuJoin * 1000 / (PARTIES * JOUEURS)).toFixed(2)} ms par joueur`);
    console.log(`CPU déroulé (${report.incomingPlay} messages entrants, diffusions, reprises incluses) : ${ms(report.cpuPlay)} ms, soit ${(report.cpuPlay * 1000 / report.incomingPlay).toFixed(2)} ms par message entrant`);
    // Mesure par `ps` (centième de seconde) autour d'une révélation seule : majorant, appel à ps compris dans la fenêtre.
    console.log(`CPU d'une révélation à ${JOUEURS} sockets : ${(report.cpuReveal * 1000 / report.reveals).toFixed(0)} ms en moyenne sur ${report.reveals} révélations`);
    if (report.hibernationPauseMs) console.log(`CPU pendant la pause d'inactivité de ${report.hibernationPauseMs / 1000} s (sockets ouverts) : ${ms(report.cpuPause)} ms`);
  }
  if (report.leaks > 0) throw new Error("correction détectée avant révélation");
} catch (error) {
  console.error(error);
  exitCode = 1;
} finally {
  await server.stop();
}
process.exit(exitCode);
