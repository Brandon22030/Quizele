"use client";

import { useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { RuleFrame } from "@/components/ui/rule-frame";
import { createClient } from "@/lib/supabase/client";

function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" className="size-5" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.9-2.26 5.36-4.78 7.02l7.73 6c4.51-4.18 7.09-10.36 7.09-17.49z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-3-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C1.02 16.46 0 20.12 0 24c0 3.88 1.02 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.9l-7.97 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

export default function ConnexionPage() {
  const [email, setEmail] = useState("");
  const [magicLinkLoading, setMagicLinkLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redirectTo =
    typeof window !== "undefined"
      ? `${window.location.origin}/auth/callback`
      : "";

  async function handleMagicLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMagicLinkLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });

    setMagicLinkLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    setSent(true);
  }

  async function handleGoogle() {
    setGoogleLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });

    setGoogleLoading(false);

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
              loading={magicLinkLoading}
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
            loading={googleLoading}
            onClick={handleGoogle}
            className="w-full border-[#DADCE0] bg-white text-[#3C4043] hover:bg-[#f7f8f8] hover:text-[#3C4043]"
          >
            {!googleLoading && <GoogleLogo />}
            Continuer avec Google
          </Button>
        )}
      </RuleFrame>

      <Link
        href="/"
        className="mt-6 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        ← Revenir à l&apos;accueil
      </Link>
    </main>
  );
}
