import { Forme, type FormeProps } from "./forme";

export function Explosion({ children, ...rest }: FormeProps) {
  return (
    <Forme forme="explosion" {...rest}>
      {children}
    </Forme>
  );
}
