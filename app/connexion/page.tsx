"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { RuleFrame } from "@/components/ui/rule-frame";
import { createClient } from "@/lib/supabase/client";

export default function ConnexionPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redirectTo =
    typeof window !== "undefined"
      ? `${window.location.origin}/auth/callback`
      : "";

  async function handleMagicLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    setSent(true);
  }

  async function handleGoogle() {
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });

    setLoading(false);

    if (error) {
      setError(error.message);
    }
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-8">
      <RuleFrame
        className="w-full max-w-sm space-y-6 rounded-md border border-adire bg-card p-6 text-card-foreground"
        position="top"
      >
        <div className="space-y-2 text-center">
          <h1 className="font-display text-2xl text-foreground">
            Connexion créateur
          </h1>
          <p className="text-sm text-muted-foreground">
            Les participants n&apos;ont pas besoin de s&apos;identifier ici.
          </p>
        </div>

        {sent ? (
          <div className="space-y-4 rounded-sm bg-or/10 p-4 text-foreground">
            <p className="text-base">
              Ouvre le lien que nous venons d&apos;envoyer à{" "}
              <strong className="font-medium">{email}</strong>.
            </p>
            <Button
              variant="ghost"
              size="md"
              onClick={() => {
                setSent(false);
                setError(null);
              }}
            >
              Utiliser une autre adresse
            </Button>
          </div>
        ) : (
          <form onSubmit={handleMagicLink} className="space-y-6">
            <FormField
              id="email"
              label="Adresse e-mail"
              error={error ?? undefined}
            >
              <Input
                type="email"
                placeholder="jean@exemple.bj"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoComplete="email"
              />
            </FormField>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={loading}
              className="w-full"
            >
              Recevoir le lien magique
            </Button>
          </form>
        )}

        {!sent && (
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-adire/30" />
            </div>
            <div className="relative flex justify-center text-xs uppercase text-muted-foreground">
              <span className="bg-card px-2">ou</span>
            </div>
          </div>
        )}

        {!sent && (
          <Button
            type="button"
            variant="secondary"
            size="lg"
            loading={loading}
            onClick={handleGoogle}
            className="w-full"
          >
            Continuer avec Google
          </Button>
        )}
      </RuleFrame>
    </main>
  );
}
