"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-encre/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-md border border-adire bg-card p-6 text-card-foreground shadow-soft"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg text-foreground">{title}</h2>
          <Button
            type="button"
            variant="ghost"
            size="md"
            aria-label="Fermer"
            onClick={onClose}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}
