import { useState } from "react";
import { BookOpen, Trash2 } from "lucide-react";
import { Button, IconButton } from "./button";
import { EtatErreur } from "./etat-erreur";
import { Feuille } from "./feuille";
import { FormField } from "./form-field";
import { Input } from "./input";
import { Interrupteur } from "./interrupteur";
import { MenuCompte } from "./menu-compte";
import { Modal } from "./modal";
import { Onglets } from "./onglets";
import { OptionMode } from "./option-mode";
import { Repli } from "./repli";
import { Toast, ZoneToasts } from "./toast";

interface DemoInteractiveProps {
  /** Sur fond forêt, les dialogues sont omis : leur papier crème garde son propre anneau de focus. */
  foret?: boolean;
}

/** Variantes qui ont besoin d'état ou de JavaScript, pour le guide de style uniquement. */
export default function DemoInteractive({ foret = false }: DemoInteractiveProps) {
  const [feuille, setFeuille] = useState(false);
  const [modal, setModal] = useState(false);
  const [toast, setToast] = useState(false);
  const [mode, setMode] = useState("ensemble");
  const [pseudo, setPseudo] = useState("");
  const [avertissement, setAvertissement] = useState(false);
  const erreur = avertissement && pseudo.trim() === "" ? "Choisis un pseudo pour rejoindre la partie." : undefined;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-3">
        {foret ? null : (
          <>
            <Button variante="creme" taille="petit" onClick={() => setFeuille(true)}>
              Ouvrir la feuille
            </Button>
            <Button variante="creme" taille="petit" onClick={() => setModal(true)}>
              Ouvrir la modale
            </Button>
          </>
        )}
        <Button variante="soleil" taille="petit" onClick={() => setToast(true)}>
          Afficher un message
        </Button>
        <MenuCompte nom="Marie Dupont" email="marie@exemple.fr" deconnexionHref="#deconnexion" />
      </div>

      <Onglets
        label="Vue des quiz"
        onglets={[
          { id: "quiz", label: "Mes quiz (1)" },
          { id: "parties", label: "Parties jouées" },
        ]}
      >
        {(actif, panneau) => (
          <p {...panneau} className="pt-3 text-base font-semibold">
            {actif === "quiz" ? "Liste de tes quiz." : "Liste des parties jouées."}
          </p>
        )}
      </Onglets>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 font-affiche text-lg">Comment on joue ?</legend>
        <OptionMode
          name={foret ? "mode-foret" : "mode"}
          value="ensemble"
          checked={mode === "ensemble"}
          onChange={() => setMode("ensemble")}
          titre="Tout le monde ensemble"
          description="Tu lances chaque question, la salle répond en même temps."
        />
        <OptionMode
          name={foret ? "mode-foret" : "mode"}
          value="rythme"
          checked={mode === "rythme"}
          onChange={() => setMode("rythme")}
          titre="Chacun à son rythme"
          description="Tu partages le lien, chacun joue quand il veut."
        />
      </fieldset>

      <div className="flex flex-col">
        <Interrupteur label="Montrer la bonne réponse" description="Après chaque question, avec l'explication." defaultChecked />
        <Interrupteur label="Mélanger l'ordre" description="Questions et réponses, pour éviter de copier." />
      </div>

      <Repli titre="Référence et explication" icone={<BookOpen className="size-5" />}>
        <p className="text-base font-semibold">Un contenu replié, accessible au clavier.</p>
      </Repli>

      <FormField label="Ton pseudo" aide="20 caractères au maximum." erreur={erreur}>
        {(control) => (
          <Input
            {...control}
            invalide={Boolean(erreur)}
            value={pseudo}
            maxLength={20}
            placeholder="Ex. Salomon"
            onChange={(e) => setPseudo(e.target.value)}
            onBlur={() => setAvertissement(true)}
          />
        )}
      </FormField>

      <EtatErreur titre="Connexion perdue" onRetry={() => setToast(true)}>
        Tes modifications sont gardées sur ce téléphone et partiront dès que le réseau revient.
      </EtatErreur>

      {foret ? null : (
        <>
          <Feuille open={feuille} onClose={() => setFeuille(false)} titre="Tes questions">
            <p className="text-base font-semibold">Réorganise tes questions avec les flèches ou en les glissant.</p>
            <Button taille="petit" onClick={() => setFeuille(false)}>
              Terminé
            </Button>
          </Feuille>
          <Modal open={modal} onClose={() => setModal(false)} titre="Supprimer ce quiz ?">
            <p className="text-base font-semibold">Cette action est définitive.</p>
            <div className="flex gap-3">
              <Button variante="creme" taille="petit" onClick={() => setModal(false)}>
                Annuler
              </Button>
              <Button taille="petit" onClick={() => setModal(false)}>
                <Trash2 aria-hidden="true" className="size-4" />
                Supprimer
              </Button>
            </div>
          </Modal>
        </>
      )}

      {toast ? (
        <ZoneToasts>
          <Toast variante="succes" duree={4000} onClose={() => setToast(false)}>
            Enregistré.
          </Toast>
        </ZoneToasts>
      ) : null}
      <IconButton label="Supprimer (exemple)" danger icone={<Trash2 className="size-5" />} className="self-start" />
    </div>
  );
}
