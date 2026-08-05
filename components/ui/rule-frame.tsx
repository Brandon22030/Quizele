import * as React from "react";

import { cn } from "@/lib/utils";

type RuleFrameProps = React.HTMLAttributes<HTMLDivElement> & {
  ruleClassName?: string;
  position?: "left" | "top";
};

function RuleFrame({
  children,
  className,
  ruleClassName,
  position = "left",
  ...props
}: RuleFrameProps) {
  return (
    <div className={cn("relative overflow-hidden", className)} {...props}>
      <span
        className={cn(
          "absolute bg-indigo",
          position === "left"
            ? "left-0 top-0 h-full w-rule"
            : "left-0 top-0 h-rule w-full",
          ruleClassName
        )}
        aria-hidden="true"
      />
      {children}
    </div>
  );
}

export { RuleFrame };
export type { RuleFrameProps };
