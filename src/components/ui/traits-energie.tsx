import type { SVGAttributes } from "react";
import { cn } from "./cn";

export function TraitsEnergie({ className, ...rest }: SVGAttributes<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 40 40"
      fill="none"
      stroke="currentColor"
      strokeWidth="4"
      strokeLinecap="round"
      className={cn("size-10 text-vert-foret", className)}
      {...rest}
    >
      <path d="M20 4V13" />
      <path d="M5 11L12 17" />
      <path d="M35 11L28 17" />
    </svg>
  );
}
