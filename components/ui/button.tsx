import * as React from "react";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "destructive";
  size?: "md" | "lg";
  loading?: boolean;
};

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      loading = false,
      children,
      disabled,
      ...props
    },
    ref
  ) => {
    const base =
      "inline-flex items-center justify-center gap-2 rounded-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";

    const variants = {
      primary: "bg-indigo text-craie hover:bg-adire",
      secondary:
        "border border-adire bg-transparent text-foreground hover:bg-adire/10",
      ghost: "bg-transparent text-foreground hover:bg-adire/10",
      destructive: "bg-rubrique text-craie hover:opacity-90",
    };

    const sizes = {
      md: "min-h-12 px-5 text-base",
      lg: "min-h-14 px-6 text-lg",
    };

    return (
      <button
        ref={ref}
        className={cn(base, variants[variant], sizes[size], className)}
        disabled={disabled || loading}
        aria-busy={loading}
        {...props}
      >
        {loading && (
          <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";

export { Button, type ButtonProps };
