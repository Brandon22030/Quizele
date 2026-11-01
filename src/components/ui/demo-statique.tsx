import { Clock, Pencil, Play, Trash2 } from "lucide-react";
import { BadgeEtoile } from "./badge-etoile";
import { Button, IconButton } from "./button";
import { EtatErreur } from "./etat-erreur";
import { EtatVide } from "./etat-vide";
import { Explosion } from "./explosion";
import { Marque } from "./marque";
import { Papier } from "./papier";
import { Pilule } from "./pilule";
import { Squelette } from "./squelette";
import { TitreAffiche } from "./titre-affiche";
import { Toast } from "./toast";
import { Ticket } from "./ticket";
import { TraitsEnergie } from "./traits-energie";

/** Variantes statiques sur fond jaune, pour le guide de style uniquement. */
export function DemoStatiqueJaune() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between gap-3">
        <Marque href="#" />
        <Button taille="petit" variante="creme">
          Rejoindre
        </Button>
      </div>

      <div className="relative flex flex-col items-center gap-3 py-4">
        <TitreAffiche as="h1" className="text-center text-5xl">
          Guide de style
        </TitreAffiche>
        <TraitsEnergie className="absolute top-0 right-2 rotate-12" />
        <Pilule inclinaison="gauche">Fond jaune soleil</Pilule>
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="font-affiche text-2xl">Boutons</h2>
        <Button bloc>Rejoindre la partie</Button>
        <Button variante="soleil" bloc>
          Soleil
        </Button>
        <Button variante="creme" bloc>
          Crème
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <Button taille="petit">
            <Pencil aria-hidden="true" className="size-4" />
            Petit
          </Button>
          <IconButton label="Heure" icone={<Clock className="size-5" />} />
          <IconButton label="Supprimer" danger icone={<Trash2 className="size-5" />} />
          <IconButton label="Lancer" variante="soleil" icone={<Play className="size-5" />} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button chargement>Envoi</Button>
          <Button disabled>Désactivé</Button>
          <Button className="-translate-x-1 translate-y-1 shadow-relief-appui">Appui</Button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-affiche text-2xl">Pilules</h2>
        <div className="flex flex-wrap gap-3">
          <Pilule>Jouer</Pilule>
          <Pilule variante="creme" inclinaison="gauche">
            Apprendre
          </Pilule>
          <Pilule variante="soleil" inclinaison="droite">
            Partager
          </Pilule>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-affiche text-2xl">Formes</h2>
        <div className="flex flex-wrap items-center gap-4">
          <BadgeEtoile>On joue !</BadgeEtoile>
          <BadgeEtoile variante="soleil">Juste !</BadgeEtoile>
          <Explosion variante="eclat" className="font-badge text-lg">
            OK
          </Explosion>
          <Explosion variante="piment" className="font-badge text-lg">
            Non
          </Explosion>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-affiche text-2xl">Papier et ticket</h2>
        <Papier incline>
          <h3 className="font-affiche text-xl">Créer</h3>
          <p className="text-sm font-semibold">Tu écris tes questions, les propositions et les explications.</p>
        </Papier>
        <Ticket>
          <p className="text-center font-affiche text-xl text-jaune-soleil">Prochaine partie</p>
          <p className="mt-2 text-center">
            <Pilule variante="soleil">19h00</Pilule>
          </p>
        </Ticket>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-affiche text-2xl">États</h2>
        <EtatVide
          icone={<Clock className="size-10" />}
          titre="Aucune partie jouée"
          action={
            <Button bloc>
              <Play aria-hidden="true" className="size-5" />
              Lancer un quiz
            </Button>
          }
        >
          Lance un quiz avec ta salle : le classement arrivera ici.
        </EtatVide>
        <EtatErreur titre="Connexion perdue">Tes modifications sont gardées sur ce téléphone.</EtatErreur>
        <div className="flex flex-col gap-3" aria-busy="true">
          <p className="font-extrabold">Ouverture du quiz...</p>
          <Squelette className="h-12" />
          <Squelette className="h-20" />
        </div>
        <Toast variante="info">Message d'information.</Toast>
        <Toast variante="erreur">Enregistrement échoué.</Toast>
      </section>
    </div>
  );
}

/** Variantes statiques sur fond forêt (le conteneur porte data-theme="foret"). */
export function DemoStatiqueForet() {
  return (
    <div className="flex flex-col gap-6">
      <h2 className="font-affiche text-3xl">Fond forêt</h2>
      <div className="flex flex-wrap items-center gap-3">
        <Pilule variante="creme">Crème</Pilule>
        <Pilule variante="soleil">Soleil</Pilule>
        <Pilule variante="foret">Forêt</Pilule>
      </div>
      <Button variante="soleil" bloc>
        Soleil sur forêt
      </Button>
      <Button variante="creme" taille="petit" className="self-start">
        Crème petit
      </Button>
      <Ticket>
        <p className="text-center font-affiche text-4xl text-jaune-soleil">K7Q</p>
      </Ticket>
    </div>
  );
}
