import * as React from "react";

import { cn } from "@/lib/utils";

type FormFieldProps = {
  id: string;
  label: string;
  help?: string;
  error?: string;
  className?: string;
  children: React.ReactElement<{
    id?: string;
    "aria-invalid"?: boolean;
    "aria-describedby"?: string;
  }>;
};

function FormField({ id, label, help, error, className, children }: FormFieldProps) {
  const helpId = help && !error ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("space-y-2", className)}>
      <label
        htmlFor={id}
        className="text-sm font-medium text-foreground"
      >
        {label}
      </label>
      {React.cloneElement(children, {
        id,
        "aria-invalid": !!error,
        "aria-describedby": describedBy,
      })}
      {help && !error && (
        <p id={helpId} className="text-xs text-muted-foreground">
          {help}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs text-rubrique">
          {error}
        </p>
      )}
    </div>
  );
}

export { FormField };
