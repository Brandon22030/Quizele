import { Copy } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "../../components/ui/button";
import { cn } from "../../components/ui/cn";
import { urlJoueur } from "./logique";

interface TicketCodeProps {
  code: string;
  etiquette?: string;
  className?: string;
  /** Taille du code : le mobile garde le jeton 4xl, la projection monte au jeton 7xl dès l'écran large. */
  grand?: boolean;
}

// Ticket jaune sur fond forêt (maquette g) : le composant Ticket est vert forêt et disparaîtrait sur ce fond.
export function TicketCode({ code, etiquette = "Code à partager", className, grand = false }: TicketCodeProps) {
  return (
    <div className="ticket-ombre">
      <div className={cn("ticket-perfore relative rounded-md bg-jaune-soleil px-5 py-8 text-center text-vert-foret", className)}>
        <span aria-hidden="true" className="pointer-events-none absolute inset-2 rounded-sm border-trait border-dotted border-vert-foret" />
        <div className="relative">
          <p className="font-extrabold">{etiquette}</p>
          <p
            className={cn(
              "mt-2 font-affiche leading-none tracking-widest text-creme text-shadow-affiche-sm",
              grand ? "text-4xl sm:text-6xl lg:text-7xl" : "text-4xl",
            )}
          >
            <span className="sr-only">Code de la partie : </span>
            {code}
          </p>
        </div>
      </div>
    </div>
  );
}

interface QrProps {
  url: string;
  className?: string;
}

// Fond crème et modules vert nuit pris par currentColor : aucune couleur n'est écrite ici, tout vient des jetons.
export function CodeQr({ url, className }: QrProps) {
  return (
    <div className={cn("shrink-0 rounded-md border-trait border-vert-nuit bg-creme p-2 text-vert-nuit shadow-relief-jaune", className)}>
      {url ? <QRCodeSVG value={url} size={256} bgColor="transparent" fgColor="currentColor" level="M" title="QR code pour rejoindre la partie" className="size-full" /> : null}
    </div>
  );
}

interface LienProps {
  code: string;
  origine: string;
  onCopier: () => void;
}

// Lien affiché en clair pour pouvoir le lire à voix haute ou le dicter, avec le QR pour le scan.
export function PartageCode({ code, origine, onCopier }: LienProps) {
  const url = origine ? urlJoueur(origine, code) : "";
  return (
    <div className="flex items-center gap-4">
      <CodeQr url={url} className="w-2/5 lg:w-1/3" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold break-all">{url.replace(/^https?:\/\//, "")}</p>
        <Button taille="petit" variante="soleil" className="mt-3" onClick={onCopier}>
          <Copy aria-hidden="true" className="size-5" />
          Copier le lien
        </Button>
      </div>
    </div>
  );
}
