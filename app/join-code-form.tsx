"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const CODE_LENGTH = 6;

export function JoinCodeForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const trimmed = code.trim().toUpperCase();
    if (trimmed.length !== CODE_LENGTH) {
      setError("Le code fait 6 caractères.");
      return;
    }

    router.push(`/q/${trimmed}`);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row">
      <Input
        value={code}
        onChange={(event) => setCode(event.target.value.toUpperCase())}
        placeholder="ABCDEF"
        maxLength={CODE_LENGTH}
        aria-label="Code de la partie"
        className="h-14 text-center text-lg uppercase tracking-widest sm:w-48"
      />
      <Button type="submit" variant="primary" size="lg" className="h-14">
        Rejoindre
      </Button>
      {error && <p className="text-sm text-rubrique">{error}</p>}
    </form>
  );
}
