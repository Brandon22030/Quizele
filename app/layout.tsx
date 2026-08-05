import type { Metadata } from "next";
import { Fraunces, Instrument_Sans, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";
import { ToastProvider, Toaster } from "@/components/ui/toast";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin-ext"],
  axes: ["opsz"],
  display: "swap",
});

const instrumentSans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin-ext"],
  weight: ["400", "500"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin-ext"],
  weight: ["500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Quizele — quiz bibliques en direct",
  description: "Crée des quiz bibliques, partage-les avec un code et joue avec ta salle en temps réel.",
  metadataBase: new URL("https://quizele.app"),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fr"
      suppressHydrationWarning
      className={`${fraunces.variable} ${instrumentSans.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <ToastProvider>
            {children}
            <Toaster />
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
