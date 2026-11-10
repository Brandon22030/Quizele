import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint();

async function messages(filePath: string, code: string) {
  const [resultat] = await eslint.lintText(code, { filePath });
  return resultat.messages.filter((m) => m.ruleId === "no-restricted-imports");
}

describe("règle ESLint : src/server interdit côté client", () => {
  it.each([
    "src/islands/x/a.ts",
    "src/components/ui/a.ts",
    "src/client/realtime/a.ts",
    "src/shared/a.ts",
  ])("refuse l'import de src/server depuis %s", async (chemin) => {
    expect(await messages(chemin, 'import { runScheduled } from "../../server/cron";\nexport { runScheduled };\n')).toHaveLength(1);
  });

  it("autorise l'import de src/server depuis le code serveur et les actions", async () => {
    const code = 'import { runScheduled } from "./server/cron";\nexport { runScheduled };\n';
    expect(await messages("src/worker.ts", code)).toHaveLength(0);
    expect(await messages("src/actions/quiz.ts", code)).toHaveLength(0);
  });
});
