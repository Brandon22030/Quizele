import { useEffect, useId, useState, type FormEvent } from "react";
import { CodeCases } from "../../components/jeu/CodeCases";
import { Button } from "../../components/ui/button";
import { EtatErreur } from "../../components/ui/etat-erreur";
import { FormField } from "../../components/ui/form-field";
import { Input } from "../../components/ui/input";
import { Papier } from "../../components/ui/papier";
import { Squelette } from "../../components/ui/squelette";
import { PSEUDO_MAX_LENGTH } from "../../shared/protocol";
import { JOIN_MESSAGES, isCompleteCode, joinGame, playPath, readToken, validatePseudo, writeToken, type JoinFailure } from "./inscription";

interface Props {
  initialCode: string;
}

type Phase = "verification" | "saisie" | "envoi";

// Erreurs qui concernent le code : elles s'affichent près du code, pas du pseudo.
const CODE_ERRORS: JoinFailure[] = ["game_not_found", "game_finished"];

export default function Rejoindre({ initialCode }: Props) {
  const [code, setCode] = useState(initialCode);
  const [pseudo, setPseudo] = useState("");
  // Avec un code complet, on regarde d'abord s'il existe un jeton : on ne montre pas le formulaire pour rien.
  const [phase, setPhase] = useState<Phase>(isCompleteCode(initialCode) ? "verification" : "saisie");
  const [failure, setFailure] = useState<JoinFailure | null>(null);
  const [pseudoError, setPseudoError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const labelId = useId();
  const aideId = useId();

  useEffect(() => {
    if (phase !== "verification") return;
    if (readToken(window.localStorage, initialCode)) {
      window.location.replace(playPath(initialCode));
      return;
    }
    setPhase("saisie");
  }, [phase, initialCode]);

  const changeCode = (value: string) => {
    setCode(value);
    setCodeError(null);
    if (failure && CODE_ERRORS.includes(failure)) setFailure(null);
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (phase === "envoi") return;
    setFailure(null);
    const nextCodeError = isCompleteCode(code) ? null : "Le code fait 6 caractères.";
    const nextPseudoError = validatePseudo(pseudo);
    setCodeError(nextCodeError);
    setPseudoError(nextPseudoError);
    if (nextCodeError || nextPseudoError) return;

    setPhase("envoi");
    const result = await joinGame(code, pseudo);
    if (!result.ok) {
      setPhase("saisie");
      if (result.error === "invalid_pseudo" || result.error === "pseudo_taken") setPseudoError(JOIN_MESSAGES[result.error]);
      else setFailure(result.error);
      return;
    }
    // Sans stockage, le joueur est inscrit mais ne pourrait pas jouer : on le dit plutôt que de le laisser sur un écran cassé.
    if (!writeToken(window.localStorage, code, result)) {
      setPhase("saisie");
      setFailure("unknown");
      return;
    }
    window.location.assign(playPath(code));
  };

  if (phase === "verification") {
    return (
      <div role="status" className="flex flex-col gap-4 px-5 py-8">
        <span className="sr-only">Chargement de ta partie</span>
        <Squelette className="h-20" />
        <Squelette className="h-14" />
      </div>
    );
  }

  const envoi = phase === "envoi";

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <Papier className="mx-4 px-4 py-6">
        <p id={labelId} className="mb-3 text-center text-sm font-extrabold tracking-wide uppercase">
          Code de la partie
        </p>
        <CodeCases
          labelledBy={labelId}
          value={code}
          onChange={changeCode}
          disabled={envoi}
          invalid={Boolean(codeError) || failure === "game_not_found" || failure === "game_finished"}
          describedBy={aideId}
          autoFocus={!isCompleteCode(initialCode)}
        />
        <p id={aideId} className="mt-3 text-center text-sm font-semibold text-vert-mousse">
          {code === "" ? "Le code est affiché sur l'écran de l'animateur. Tu peux aussi le coller en entier." : "Tu peux aussi coller le code entier."}
        </p>
        {codeError ? (
          <p role="alert" className="mt-3 text-center text-sm font-extrabold text-piment">
            {codeError}
          </p>
        ) : null}
      </Papier>

      <div className="flex flex-col gap-5 px-5">
        {failure ? (
          <EtatErreur onRetry={failure === "network" ? () => void submit() : undefined}>{JOIN_MESSAGES[failure]}</EtatErreur>
        ) : null}
        <FormField label="Pseudo" aide={`${PSEUDO_MAX_LENGTH} caractères maximum. C'est ce nom qui s'affiche au classement.`} erreur={pseudoError ?? undefined}>
          {(control) => (
            <Input
              {...control}
              value={pseudo}
              onChange={(e) => {
                setPseudo(e.target.value);
                setPseudoError(null);
              }}
              disabled={envoi}
              autoComplete="nickname"
              autoCapitalize="none"
              autoFocus={isCompleteCode(initialCode)}
              placeholder="Ton pseudo"
            />
          )}
        </FormField>
        <Button type="submit" bloc chargement={envoi} libelleChargement="Inscription en cours">
          Rejoindre
        </Button>
      </div>
    </form>
  );
}
