"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { LogOut, Moon, Sun, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export function AccountMenu() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
    });
  }, []);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/connexion";
  }

  function toggleTheme() {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  }

  return (
    <div className="relative">
      <Button
        type="button"
        variant="ghost"
        size="md"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <User className="size-4" aria-hidden="true" />
        <span className="sr-only">Compte</span>
      </Button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-56 rounded-md border border-adire bg-card p-2 shadow-soft">
          <div className="border-b border-adire/30 px-3 py-2">
            <p className="text-sm font-medium text-foreground truncate">
              {email ?? "Créateur"}
            </p>
          </div>

          <div className="space-y-1 py-1">
            <Button
              type="button"
              variant="ghost"
              size="md"
              className="w-full justify-start"
              onClick={toggleTheme}
            >
              {theme === "dark" ? (
                <Sun className="size-4" aria-hidden="true" />
              ) : (
                <Moon className="size-4" aria-hidden="true" />
              )}
              <span className="ml-2">Thème {resolvedTheme === "dark" ? "craie" : "encre"}</span>
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="md"
              className="w-full justify-start text-rubrique hover:text-rubrique"
              onClick={handleSignOut}
            >
              <LogOut className="size-4" aria-hidden="true" />
              <span className="ml-2">Se déconnecter</span>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
