import type { ReactNode } from "react";

// À retirer quand MenuCompte gère la déconnexion : Better Auth répond 415 à un POST de formulaire (JSON exigé), on
// intercepte donc le submit de MenuCompte pour envoyer la requête en JSON.
export function DeconnexionJson({ children, onErreur }: { children: ReactNode; onErreur: () => void }) {
  async function deconnecter() {
    try {
      const reponse = await fetch("/api/auth/sign-out", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!reponse.ok) throw new Error("sign-out");
      window.location.assign("/");
    } catch {
      onErreur();
    }
  }
  return (
    <div
      onSubmit={(e) => {
        e.preventDefault();
        void deconnecter();
      }}
    >
      {children}
    </div>
  );
}
