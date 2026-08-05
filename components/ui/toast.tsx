"use client";

import * as React from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

type ToastVariant = "success" | "error" | "info";

type Toast = {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
};

type ToastContextValue = {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, "id">) => void;
  removeToast: (id: string) => void;
};

const ToastContext = React.createContext<ToastContextValue | undefined>(
  undefined
);

function generateId() {
  return Math.random().toString(36).slice(2, 9);
}

function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  const addToast = React.useCallback((toast: Omit<Toast, "id">) => {
    setToasts((prev) => [...prev, { ...toast, id: generateId() }]);
  }, []);

  const removeToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
    </ToastContext.Provider>
  );
}

function useToast() {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
}

const variantClasses: Record<ToastVariant, string> = {
  success: "border-or",
  error: "border-rubrique",
  info: "border-indigo",
};

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: () => void;
}) {
  React.useEffect(() => {
    const timer = setTimeout(onDismiss, 5000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div
      className={cn(
        "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-md border bg-card p-4 text-card-foreground shadow-soft",
        variantClasses[toast.variant]
      )}
      role="status"
    >
      <div className="flex-1 space-y-1">
        <p className="text-sm font-medium">{toast.title}</p>
        {toast.description && (
          <p className="text-xs text-muted-foreground">{toast.description}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-adire/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Fermer la notification"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

function Toaster() {
  const { toasts, removeToast } = useToast();

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 flex flex-col gap-2 sm:left-auto sm:right-4 sm:w-full sm:max-w-sm">
      {toasts.map((toast) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onDismiss={() => removeToast(toast.id)}
        />
      ))}
    </div>
  );
}

export { ToastProvider, useToast, Toaster };
export type { Toast, ToastVariant };
