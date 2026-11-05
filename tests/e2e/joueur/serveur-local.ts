import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { PORT_PREVIEW, portDedie } from "../serveurs";

// Port propre à ces specs (E2E_PORT_JEU l'emporte, sinon dérivé de E2E_PORT_PREVIEW comme les autres serveurs) : serveur dédié lancé avec LOCAL_TOOLS=true (requis par la route de lancement locale), sans dépendre de la config du serveur Playwright.
// Un serveur par worker Playwright : deux fichiers de ce dossier tournent en parallèle et se disputeraient le même port
// (le second lancement échoue à s'y lier mais le sondage de démarrage répond, d'où des tests sur une base qui n'est pas la leur).
export const PORT_JEU = portDedie(90, process.env.E2E_PORT_JEU ? Number(process.env.E2E_PORT_JEU) - 90 : PORT_PREVIEW);
export const URL_JEU = `http://localhost:${PORT_JEU}`;
const CONFIG = "dist/server/wrangler.json";
export const SOUS_PROTOCOLE = "quizdeszeles.v1";

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

function terminerArbre(enfant: ChildProcess) {
  if (!enfant.pid) return;
  for (const pid of descendants(enfant.pid).reverse()) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // déjà arrêté
    }
  }
}

function descendants(racine: number): number[] {
  const lignes = execFileSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" }).split("\n").filter(Boolean);
  const procs = lignes.map((l) => l.trim().split(/\s+/).map(Number) as [number, number]);
  const trouves = new Set([racine]);
  for (let grandit = true; grandit; ) {
    grandit = false;
    for (const [pid, ppid] of procs) {
      if (!trouves.has(pid) && trouves.has(ppid)) {
        trouves.add(pid);
        grandit = true;
      }
    }
  }
  return [...trouves];
}

export interface ServeurLocal {
  arreter: () => Promise<void>;
}

// wrangler dev sur le bundle construit, avec les outils locaux. Arrêt par PID de notre propre arbre seulement :
// d'autres projets font tourner leurs workerd sur la machine.
export async function demarrerServeur(): Promise<ServeurLocal> {
  if (!existsSync(CONFIG)) throw new Error("dist/server/wrangler.json absent : lancer `npm run build` d'abord.");
  // Base jetable : l'état local par défaut est celui du serveur preview des e2e, que cette migration verrouillait (échec
  // sous charge) et dont elle changeait les réponses (un code fictif devenait « inconnu »).
  const dossier = mkdtempSync(join(tmpdir(), "qz002-11-"));
  // Deux wrangler lancés en même temps par des workers différents se disputent parfois le socket interne de workerd
  // (« Address already in use » sans rapport avec notre port) : on retente après une pause décalée plutôt que d'échouer.
  let enfant!: ChildProcess;
  let journal = "";
  try {
    execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--local", "--config", CONFIG, "--persist-to", dossier], { stdio: "ignore" });
    for (let essai = 1; ; essai++) {
      enfant = spawn(
        "npx",
        ["wrangler", "dev", "--config", CONFIG, "--port", String(PORT_JEU), "--local", "--persist-to", dossier, "--var", "LOCAL_TOOLS:true"],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      journal = "";
      let sorti = false;
      enfant.once("exit", () => (sorti = true));
      enfant.stdout?.on("data", (d) => (journal += d));
      enfant.stderr?.on("data", (d) => (journal += d));
      const limite = Date.now() + 90_000;
      while (!journal.includes("Ready on") && !sorti) {
        if (Date.now() > limite) throw new Error(`wrangler dev ne répond pas :\n${journal}`);
        await attendre(300);
      }
      if (journal.includes("Ready on")) break;
      if (essai >= 4 || !journal.includes("Address already in use")) throw new Error(`wrangler dev s'est arrêté :\n${journal}`);
      await attendre(1_000 + Math.random() * 3_000);
    }
    await fetch(`${URL_JEU}/`, { signal: AbortSignal.timeout(60_000) }).catch(() => undefined);
  } catch (erreur) {
    // Arbre de processus et base jetable ne doivent pas survivre à un démarrage manqué.
    if (enfant) terminerArbre(enfant);
    rmSync(dossier, { recursive: true, force: true });
    throw erreur;
  }
  return {
    arreter: async () => {
      terminerArbre(enfant);
      await Promise.race([once(enfant, "exit"), attendre(5000)]);
      rmSync(dossier, { recursive: true, force: true });
    },
  };
}

export interface QuestionLocale {
  kind: "single" | "multiple" | "true_false";
  prompt: string;
  durationSec: 10 | 20 | 30 | 60;
  reference?: string;
  explanation?: string;
  options: { label: string; isCorrect: boolean }[];
}

export interface PartieLocale {
  code: string;
  hostToken: string;
}

export async function lancerPartie(body: { mode?: "together" | "own_pace"; showCorrectAnswer?: boolean; questions: QuestionLocale[] }): Promise<PartieLocale> {
  const secret = JSON.parse(readFileSync(CONFIG, "utf8")).vars?.PLAYER_TOKEN_SECRET as string | undefined;
  if (!secret) throw new Error("PLAYER_TOKEN_SECRET absent de dist/server/wrangler.json");
  const res = await fetch(`${URL_JEU}/api/parties/local`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-local-secret": secret },
    body: JSON.stringify(body),
  });
  if (res.status !== 201) throw new Error(`lancement local refusé (${res.status})`);
  return (await res.json()) as PartieLocale;
}

export async function rejoindre(code: string, pseudo: string): Promise<{ playerId: string; token: string }> {
  const res = await fetch(`${URL_JEU}/api/parties/${code}/joueurs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pseudo }),
  });
  if (res.status !== 201) throw new Error(`inscription refusée (${res.status})`);
  return (await res.json()) as { playerId: string; token: string };
}

// Animateur simulé : une socket hôte qui envoie les commandes de la télécommande.
export class Animateur {
  private readonly socket: WebSocket;
  private readonly ouverte: Promise<void>;

  constructor(code: string, token: string) {
    this.socket = new WebSocket(`ws://localhost:${PORT_JEU}/ws/${code}`, [SOUS_PROTOCOLE, token]);
    this.ouverte = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", () => resolve());
      this.socket.addEventListener("error", () => reject(new Error("connexion animateur impossible")));
    });
  }

  async envoyer(type: "start" | "reveal" | "next" | "end"): Promise<void> {
    await this.ouverte;
    this.socket.send(JSON.stringify({ type }));
  }

  fermer(): void {
    this.socket.close();
  }
}
