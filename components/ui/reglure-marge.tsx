"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";

type ReglureMargeProps = {
  durationMs: number;
  startedAt: string;
  serverNow: string;
  onExpire?: () => void;
  onTick?: (remainingMs: number, elapsedMs: number) => void;
  className?: string;
  children?: React.ReactNode;
};

function ReglureMarge({
  durationMs,
  startedAt,
  serverNow,
  onExpire,
  onTick,
  className,
  children,
}: ReglureMargeProps) {
  const prefersReducedMotion = useReducedMotion();
  const [elapsed, setElapsed] = React.useState(0);
  const expiredRef = React.useRef(false);
  const onExpireRef = React.useRef(onExpire);
  const onTickRef = React.useRef(onTick);

  React.useEffect(() => {
    onExpireRef.current = onExpire;
    onTickRef.current = onTick;
  }, [onExpire, onTick]);

  const startedAtMs = React.useMemo(() => Date.parse(startedAt), [startedAt]);
  const serverNowMs = React.useMemo(() => Date.parse(serverNow), [serverNow]);

  React.useEffect(() => {
    if (Number.isNaN(startedAtMs) || Number.isNaN(serverNowMs)) {
      return;
    }

    expiredRef.current = false;
    const localNow = Date.now();
    const drift = localNow - serverNowMs;

    let rafId: number;

    const tick = () => {
      const now = Date.now();
      const currentElapsed = Math.min(
        durationMs,
        Math.max(0, now - startedAtMs - drift)
      );
      setElapsed(currentElapsed);
      onTickRef.current?.(Math.max(0, durationMs - currentElapsed), currentElapsed);

      if (currentElapsed >= durationMs && !expiredRef.current) {
        expiredRef.current = true;
        onExpireRef.current?.();
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [startedAtMs, serverNowMs, durationMs]);

  const remaining = Math.max(0, durationMs - elapsed);
  const progress = durationMs > 0 ? remaining / durationMs : 0;
  const isDanger = remaining <= 5000;

  return (
    <div
      className={cn(
        "flex gap-4 rounded-md border border-adire bg-card p-5",
        className
      )}
    >
      <div className="relative w-rule self-stretch rounded-full bg-adire/20">
        <motion.div
          className={cn(
            "absolute inset-x-0 top-0 h-full origin-top",
            isDanger ? "bg-rubrique" : "bg-indigo",
            isDanger && !prefersReducedMotion && "animate-pulse-slow"
          )}
          initial={false}
          animate={{ scaleY: progress }}
          transition={{
            duration: prefersReducedMotion ? 0 : 0.1,
            ease: "linear",
          }}
        />
      </div>
      <div className="flex-1 space-y-2">
        <p className="font-mono text-lg text-foreground" aria-live="polite" aria-atomic="true">
          {Math.ceil(remaining / 1000).toString().replace(".", ",")}s
        </p>
        {children}
      </div>
    </div>
  );
}

export { ReglureMarge };
export type { ReglureMargeProps };
