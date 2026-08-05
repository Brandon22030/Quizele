"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-6 text-center">
      <h1 className="font-display text-3xl text-foreground">Un problème est survenu</h1>
      <p className="max-w-md text-muted-foreground">
        {error.message || "Impossible d'afficher cette page."}
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button variant="primary" size="lg" onClick={reset}>
          Réessayer
        </Button>
        <Button variant="secondary" size="lg" onClick={() => window.location.reload()}>
          Recharger la page
        </Button>
      </div>
    </main>
  );
}
