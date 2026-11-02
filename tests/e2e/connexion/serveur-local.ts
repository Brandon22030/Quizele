import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PORT_PREVIEW } from "../serveurs";

const CONFIG = "dist/server/wrangler.json";

export interface ServeurLocal {
  url: string;
  /** Résout avec le lien de connexion écrit par le transport console pour cette adresse. */
  lienMagique(email: string): Promise<string>;
  arreter(): void;
}

// Serveur wrangler dédié (base D1 jetable) : le transport console écrit le lien magique dans sa sortie, que le
// serveur de test partagé ne permet pas de lire. `vars` surcharge la config (méthodes de connexion actives).
export async function lancerServeur(decalage: number, vars: Record<string, string> = {}): Promise<ServeurLocal> {
  const port = PORT_PREVIEW + decalage;
  const dossier = mkdtempSync(join(tmpdir(), "qz002-12-"));
  const env = { ...process.env, CI: "1" };
  execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--local", "--config", CONFIG, "--persist-to", dossier], {
    env,
    stdio: "ignore",
  });
  const args = ["wrangler", "dev", "--config", CONFIG, "--port", String(port), "--persist-to", dossier];
  for (const [cle, valeur] of Object.entries(vars)) args.push("--var", `${cle}:${valeur}`);
  let sortie = "";
  const enfant: ChildProcess = spawn("npx", args, { env, detached: true });
  const lire = (morceau: Buffer) => {
    sortie += morceau.toString();
  };
  enfant.stdout?.on("data", lire);
  enfant.stderr?.on("data", lire);

  const url = `http://localhost:${port}`;
  const arreter = () => {
    // Groupe de processus entier : npx lance wrangler, qui lance workerd.
    if (enfant.pid) {
      try {
        process.kill(-enfant.pid);
      } catch {
        // Déjà arrêté.
      }
    }
    rmSync(dossier, { recursive: true, force: true });
  };

  const debut = Date.now();
  while (!sortie.includes("Ready on")) {
    if (Date.now() - debut > 60_000) {
      arreter();
      throw new Error(`wrangler dev n'a pas démarré sur ${port} :\n${sortie}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  return {
    url,
    arreter,
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
}
