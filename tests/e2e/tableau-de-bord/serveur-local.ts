import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PORT_PREVIEW } from "../serveurs";

const CONFIG = "dist/server/wrangler.json";
const DELAI_SIGKILL_MS = 5_000;

export interface ServeurLocal {
  url: string;
  /** Résout avec le lien de connexion écrit par le transport console pour cette adresse. */
  lienMagique(email: string): Promise<string>;
  /** Exécute du SQL sur la base locale du serveur (jeux de données que l'interface ne sait pas produire, ici des parties terminées). */
  sql(commande: string): void;
  arreter(): void;
}

// Registre des serveurs lancés par ce processus : un hook qui expire perd la référence retournée, mais
// arreterTout() les retrouve quand même.
const actifs = new Set<{ arreter(): void; tuerSecs(): void }>();
let gardesPosees = false;

function poserGardes() {
  if (gardesPosees) return;
  gardesPosees = true;
  // À la sortie, plus de minuterie possible : SIGKILL direct. Sur signal, on laisse l'arrêt propre puis on sort.
  process.once("exit", () => actifs.forEach((s) => s.tuerSecs()));
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      actifs.forEach((s) => s.tuerSecs());
      process.exit(signal === "SIGINT" ? 130 : 143);
    });
  }
}

export function arreterTout(): void {
  [...actifs].forEach((s) => s.arreter());
}

function portLibre(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sonde = createServer();
    sonde.once("error", () => resolve(false));
    sonde.listen(port, "127.0.0.1", () => sonde.close(() => resolve(true)));
  });
}

// Un worker Playwright par projet et par fichier : l'index du worker décale les ports, pour que deux projets
// lancés en parallèle ne visent jamais le même serveur.
const decalageWorker = Number(process.env.TEST_PARALLEL_INDEX ?? 0) * 100;

// Serveur wrangler dédié (base D1 jetable) : le transport console écrit le lien magique dans sa sortie, que le
// serveur de test partagé ne permet pas de lire. `vars` surcharge la config (méthodes de connexion actives).
export async function lancerServeur(decalage: number, vars: Record<string, string> = {}): Promise<ServeurLocal> {
  poserGardes();
  const port = PORT_PREVIEW + decalage + decalageWorker;
  if (!(await portLibre(port))) {
    throw new Error(`Le port ${port} est déjà occupé : un serveur de test précédent tourne peut-être encore (pgrep -fl "port ${port}").`);
  }
  const dossier = mkdtempSync(join(tmpdir(), "qz002-13-"));
  const env = { ...process.env, CI: "1" };

  let enfant: ChildProcess | null = null;
  const signaler = (signal: NodeJS.Signals) => {
    // Groupe de processus entier : npx lance wrangler, qui lance workerd.
    if (enfant?.pid) {
      try {
        process.kill(-enfant.pid, signal);
      } catch {
        // Déjà arrêté.
      }
    }
  };
  const serveur = {
    arreter() {
      if (!actifs.delete(serveur)) return;
      signaler("SIGTERM");
      const secours = setTimeout(() => signaler("SIGKILL"), DELAI_SIGKILL_MS);
      enfant?.once("exit", () => clearTimeout(secours));
      rmSync(dossier, { recursive: true, force: true });
    },
    tuerSecs() {
      signaler("SIGKILL");
      rmSync(dossier, { recursive: true, force: true });
    },
  };
  actifs.add(serveur);

  try {
    execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--local", "--config", CONFIG, "--persist-to", dossier], {
      env,
      stdio: "ignore",
      timeout: 120_000,
    });
    const args = ["wrangler", "dev", "--config", CONFIG, "--port", String(port), "--persist-to", dossier];
    for (const [cle, valeur] of Object.entries(vars)) args.push("--var", `${cle}:${valeur}`);
    let sortie = "";
    enfant = spawn("npx", args, { env, detached: true });
    const lire = (morceau: Buffer) => {
      sortie += morceau.toString();
    };
    enfant.stdout?.on("data", lire);
    enfant.stderr?.on("data", lire);

    const debut = Date.now();
    while (!sortie.includes("Ready on")) {
      if (Date.now() - debut > 120_000) throw new Error(`wrangler dev n'a pas démarré sur ${port} :\n${sortie}`);
      await new Promise((r) => setTimeout(r, 200));
    }

    return {
      url: `http://localhost:${port}`,
      arreter: serveur.arreter,
      sql(commande) {
        execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--local", "--config", CONFIG, "--persist-to", dossier, "--command", commande], {
          env,
          stdio: "ignore",
          timeout: 60_000,
        });
      },
      async lienMagique(email) {
        const limite = Date.now() + 15_000;
        while (Date.now() < limite) {
          const blocs = sortie.split("[mail:console]").filter((b) => b.startsWith(` à ${email} `));
          const lien = blocs.at(-1)?.match(/https?:\/\/\S+\/api\/auth\/magic-link\/verify\?\S+/)?.[0];
          if (lien) return lien;
          await new Promise((r) => setTimeout(r, 200));
        }
        throw new Error(`Aucun lien magique journalisé pour ${email}.`);
      },
    };
  } catch (erreur) {
    serveur.arreter();
    throw erreur;
  }
}
