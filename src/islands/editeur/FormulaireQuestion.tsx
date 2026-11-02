import { useId } from "react";
import { BookOpen, Copy, Plus, Trash2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import { FormField } from "../../components/ui/form-field";
import { Input, Textarea } from "../../components/ui/input";
import { Repli } from "../../components/ui/repli";
import { LONG_TEXT_MAX, MAX_OPTIONS, MIN_OPTIONS, PROMPT_MAX } from "../../shared/quiz-schema";
import { ChoixType } from "./ChoixType";
import { PucesDuree } from "./PucesDuree";
import { TuileReponseEditable } from "./TuileReponseEditable";
import {
  ajouterReponse,
  basculerJuste,
  changerLibelle,
  changerType,
  majQuestion,
  retirerReponse,
  type Brouillon,
  type QuestionBrouillon,
} from "./modele";

interface Props {
  question: QuestionBrouillon;
  numero: number;
  modifier: (fn: (b: Brouillon) => Brouillon) => void;
  // Création (k3) : énoncé et deux réponses seulement, le reste est replié ; édition : tout est déplié.
  variante: "creation" | "edition";
  onDupliquer?: () => void;
  onSupprimer?: () => void;
}

// Le compteur n'apparaît qu'en approchant de la limite : la plupart des énoncés n'en ont pas besoin.
const SEUIL_COMPTEUR = 20;

export function FormulaireQuestion({ question: q, numero, modifier, variante, onDupliquer, onSupprimer }: Props) {
  const id = useId();
  const creation = variante === "creation";
  const restant = PROMPT_MAX - q.prompt.length;
  const multiple = q.type === "multiple";

  const type = <ChoixType nom={`${id}-type`} valeur={q.type} onChange={(t) => modifier((b) => changerType(b, q.key, t))} />;
  const duree = <PucesDuree nom={`${id}-duree`} valeur={q.durationSec} onChange={(d) => modifier((b) => majQuestion(b, q.key, { durationSec: d }))} />;
  const textes = (
    <>
      <FormField label="Référence">
        {(champ) => (
          <Input
            {...champ}
            value={q.reference}
            maxLength={LONG_TEXT_MAX}
            onChange={(e) => modifier((b) => majQuestion(b, q.key, { reference: e.target.value }))}
          />
        )}
      </FormField>
      <FormField label="Explication (montrée après la question)">
        {(champ) => (
          <Textarea
            {...champ}
            rows={3}
            value={q.explanation}
            maxLength={LONG_TEXT_MAX}
            onChange={(e) => modifier((b) => majQuestion(b, q.key, { explanation: e.target.value }))}
          />
        )}
      </FormField>
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      {creation ? null : type}
      <div className="flex flex-col gap-1">
        {creation ? <p className="text-sm font-extrabold text-vert-mousse">Question {numero}</p> : null}
        <label htmlFor={`${id}-enonce`} className="sr-only">
          Énoncé de la question {numero}
        </label>
        <Textarea
          id={`${id}-enonce`}
          rows={creation ? 3 : 2}
          maxLength={PROMPT_MAX}
          value={q.prompt}
          placeholder="Écris ta question ici"
          onChange={(e) => modifier((b) => majQuestion(b, q.key, { prompt: e.target.value }))}
          className="resize-none font-affiche text-xl leading-tight font-normal lg:text-2xl"
        />
        {restant <= SEUIL_COMPTEUR ? (
          <p className="self-end text-sm font-bold text-vert-mousse">
            {restant} caractère{restant > 1 ? "s" : ""} restant{restant > 1 ? "s" : ""}
          </p>
        ) : null}
      </div>
      {/* Une seule colonne, bureau compris : deux tuiles côte à côte tronquaient les libellés dès une vingtaine de caractères. */}
      <div className="flex flex-col gap-3">
        {q.options.map((o, i) => (
          <TuileReponseEditable
            key={i}
            index={i}
            label={o.label}
            isCorrect={o.isCorrect}
            libelleFige={q.type === "true_false"}
            onLabel={(label) => modifier((b) => changerLibelle(b, q.key, i, label))}
            onToggle={() => modifier((b) => basculerJuste(b, q.key, i))}
            onRetirer={q.type !== "true_false" && q.options.length > MIN_OPTIONS && i >= MIN_OPTIONS ? () => modifier((b) => retirerReponse(b, q.key, i)) : undefined}
          />
        ))}
      </div>
      {q.type !== "true_false" && q.options.length < MAX_OPTIONS && !creation ? (
        <Button taille="petit" variante="creme" bloc className="border-dashed" onClick={() => modifier((b) => ajouterReponse(b, q.key))}>
          <Plus aria-hidden="true" className="size-5" />
          Ajouter une réponse
        </Button>
      ) : null}
      <p className="text-sm font-semibold text-vert-mousse">
        {multiple ? "Touche les ronds pour marquer les bonnes réponses." : "Touche le rond pour marquer la bonne réponse."}
      </p>
      {creation ? (
        <Repli titre="Type, durée et explication">
          {type}
          {duree}
          {textes}
        </Repli>
      ) : (
        <>
          {duree}
          <Repli titre="Référence et explication" icone={<BookOpen className="size-5" />} defaultOpen={q.reference !== "" || q.explanation !== ""}>
            {textes}
          </Repli>
          <div className="flex gap-3">
            <Button variante="creme" taille="petit" className="flex-1" onClick={onDupliquer} disabled={!onDupliquer}>
              <Copy aria-hidden="true" className="size-5" />
              Dupliquer
            </Button>
            <Button variante="creme" taille="petit" className="flex-1 text-piment" onClick={onSupprimer}>
              <Trash2 aria-hidden="true" className="size-5" />
              Supprimer
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
