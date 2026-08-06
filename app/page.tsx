import Link from "next/link";
import type { Metadata } from "next";

import { Rubrique } from "@/components/ui/rubrique";
import { RuleFrame } from "@/components/ui/rule-frame";
import { LiveDemo } from "@/app/live-demo";
import { JoinCodeForm } from "@/app/join-code-form";

const SITE_URL = "https://quizdeszeles.vercel.app";
const TITLE = "Quizdeszeles — quiz bibliques en direct";
const DESCRIPTION =
  "Crée des quiz bibliques, partage-les avec un code et joue avec ta salle en temps réel. Pas d'installation, pas de compte pour les participants.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "quiz biblique",
    "jeu en direct",
    "groupe de jeunes",
    "école du dimanche",
    "animation",
    "quiz en ligne",
  ],
  metadataBase: new URL(SITE_URL),
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: SITE_URL,
    siteName: "Quizdeszeles",
    locale: "fr_FR",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

const structuredData = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Quizdeszeles",
  url: SITE_URL,
  description: DESCRIPTION,
  inLanguage: "fr",
};

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      <header className="flex items-center justify-between border-b border-adire px-4 py-3 sm:px-6 sm:py-4">
        <span className="font-display text-lg sm:text-xl">Quizdeszeles</span>
        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/rejoindre"
            className="inline-flex h-10 items-center justify-center rounded-sm px-3 text-sm font-medium text-foreground transition-colors hover:bg-adire/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-12 sm:px-5 sm:text-base"
          >
            Rejoindre
          </Link>
          <Link
            href="/connexion"
            className="inline-flex h-10 items-center justify-center whitespace-nowrap rounded-sm bg-indigo px-3 text-sm font-medium text-craie transition-colors hover:bg-adire focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-12 sm:px-5 sm:text-base"
          >
            Créer un quiz
          </Link>
        </div>
      </header>

      <main className="flex flex-1 flex-col">
        <section className="px-6 py-12 text-center sm:py-20">
          <Rubrique>Démo</Rubrique>
          <p className="mx-auto mt-4 max-w-md text-lg">
            Ça ressemble à ça pour les participants. La question se joue toute seule.
          </p>
          <div className="mt-8 flex justify-center">
            <LiveDemo />
          </div>
        </section>

        <section className="border-t border-adire px-6 py-12 text-center sm:py-20">
          <p className="mx-auto max-w-2xl font-display text-2xl leading-snug sm:text-3xl">
            Quizdeszeles te permet de créer un quiz biblique, de le partager avec un
            code et de jouer avec ta salle en direct — sans installer quoi que
            ce soit.
          </p>
        </section>

        <section className="border-t border-adire px-6 py-12 sm:py-20">
          <div className="mx-auto grid max-w-4xl gap-6 sm:grid-cols-3">
            <RuleFrame className="rounded-sm border border-adire p-6" position="left">
              <p className="font-display text-xl">1. Créer</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Tu écris tes questions, les propositions et les explications.
                Tout s&apos;enregistre au fur et à mesure.
              </p>
            </RuleFrame>
            <RuleFrame className="rounded-sm border border-adire p-6" position="left">
              <p className="font-display text-xl">2. Partager</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Tu lances la session et tu donnes le code à tes participants.
                Ils rejoignent avec un pseudo.
              </p>
            </RuleFrame>
            <RuleFrame className="rounded-sm border border-adire p-6" position="left">
              <p className="font-display text-xl">3. Jouer</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Les questions arrivent en temps réel, le timer tourne et les
                scores s&apos;affichent à la fin.
              </p>
            </RuleFrame>
          </div>
        </section>

        <section className="border-t border-adire px-6 py-12 text-center sm:py-20">
          <p className="font-display text-2xl">Tu as un code ?</p>
          <div className="mt-6 flex justify-center">
            <JoinCodeForm />
          </div>
        </section>

        <section className="border-t border-adire px-6 py-12 text-center sm:py-20">
          <p className="font-display text-2xl">Envie d&apos;animer ?</p>
          <p className="mt-2 text-muted-foreground">
            Crée un compte gratuit pour rédiger ton premier quiz.
          </p>
          <div className="mt-6">
            <Link
              href="/connexion"
              className="inline-flex h-14 items-center justify-center rounded-sm bg-indigo px-6 text-lg font-medium text-craie transition-colors hover:bg-adire focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Créer un compte
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-adire px-6 py-6 text-center text-sm text-muted-foreground">
        Quizdeszeles — quiz bibliques pour groupes, écoles du dimanche et soirées.
      </footer>
    </div>
  );
}

