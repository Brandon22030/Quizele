"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { RuleFrame } from "@/components/ui/rule-frame";
import { useToast } from "@/components/ui/toast";

const CODE_LENGTH = 6;

export default function RejoindrePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { addToast } = useToast();
  const [code, setCode] = useState<string[]>(() => {
    const fromUrl = searchParams
      .get("code")
      ?.toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, CODE_LENGTH);

    if (!fromUrl) return Array(CODE_LENGTH).fill("");

    const next = Array(CODE_LENGTH).fill("");
    for (let i = 0; i < fromUrl.length; i += 1) {
      next[i] = fromUrl[i];
    }
    return next;
  });
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  function focusInput(index: number) {
    inputsRef.current[index]?.focus();
  }

  function handleChange(index: number, value: string) {
    const chars = value.toUpperCase().replace(/[^A-Z0-9]/g, "").split("");
    if (chars.length === 0) return;

    const next = [...code];
    let cursor = index;

    for (const char of chars) {
      if (cursor >= CODE_LENGTH) break;
      next[cursor] = char;
      cursor += 1;
    }

    setCode(next);
    focusInput(Math.min(cursor, CODE_LENGTH - 1));
  }

  function handleKeyDown(index: number, event: React.KeyboardEvent) {
    if (event.key === "Backspace") {
      event.preventDefault();
      const next = [...code];
      if (next[index]) {
        next[index] = "";
      } else if (index > 0) {
        next[index - 1] = "";
        focusInput(index - 1);
      }
      setCode(next);
    } else if (event.key === "ArrowLeft" && index > 0) {
      focusInput(index - 1);
    } else if (event.key === "ArrowRight" && index < CODE_LENGTH - 1) {
      focusInput(index + 1);
    }
  }

  function handlePaste(event: React.ClipboardEvent) {
    event.preventDefault();
    const pasted = event.clipboardData.getData("text").toUpperCase();
    const cleaned = pasted.replace(/[^A-Z0-9]/g, "").slice(0, CODE_LENGTH).split("");
    const next = Array(CODE_LENGTH).fill("");
    for (let i = 0; i < cleaned.length; i += 1) {
      next[i] = cleaned[i];
    }
    setCode(next);
    focusInput(Math.min(cleaned.length, CODE_LENGTH - 1));
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const joined = code.join("");
    if (joined.length !== CODE_LENGTH) {
      addToast({
        title: "Code incomplet",
        description: "Saisis les 6 caractères du code.",
        variant: "error",
      });
      return;
    }
    router.push(`/q/${joined}`);
  }

  useEffect(() => {
    const firstEmpty = code.findIndex((char) => char === "");
    focusInput(firstEmpty === -1 ? CODE_LENGTH - 1 : firstEmpty);
  }, [code]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4">
      <RuleFrame
        className="w-full max-w-md space-y-6 rounded-md border border-adire bg-card p-6 text-center text-card-foreground"
        position="top"
      >
        <h1 className="font-display text-2xl text-foreground">
          Rejoindre une session
        </h1>
        <p className="text-sm text-muted-foreground">
          Saisis le code à 6 caractères affiché par l&apos;animateur.
        </p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="flex justify-center gap-2">
            {code.map((char, index) => (
              <input
                key={index}
                ref={(element) => {
                  inputsRef.current[index] = element;
                }}
                type="text"
                inputMode="text"
                autoCapitalize="characters"
                maxLength={1}
                value={char}
                onChange={(event) => handleChange(index, event.target.value)}
                onKeyDown={(event) => handleKeyDown(index, event)}
                onPaste={handlePaste}
                className="size-14 rounded-sm border border-adire bg-card text-center font-mono text-3xl uppercase text-foreground shadow-sm transition-colors focus-visible:border-indigo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Caractère ${index + 1} du code`}
              />
            ))}
          </div>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="w-full"
          >
            Rejoindre
          </Button>
        </form>
      </RuleFrame>
    </main>
  );
}
