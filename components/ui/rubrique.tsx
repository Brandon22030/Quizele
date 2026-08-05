import { cn } from "@/lib/utils";

function Rubrique({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "font-mono text-xs uppercase tracking-widest text-adire",
        className
      )}
    >
      {children}
    </span>
  );
}

export { Rubrique };
