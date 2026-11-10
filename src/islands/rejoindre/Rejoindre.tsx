import { BookOpen } from "lucide-react";
import { useEffect, useId, useState, type FormEvent } from "react";
import { CodeCases } from "../../components/jeu/CodeCases";
import { CODE_LENGTH } from "../../components/jeu/code-input";
import { Button } from "../../components/ui/button";
import { EtatErreur } from "../../components/ui/etat-erreur";
import { Forme } from "../../components/ui/forme";
import { FormField } from "../../components/ui/form-field";
import { Input } from "../../components/ui/input";
import { Papier } from "../../components/ui/papier";
import { Squelette } from "../../components/ui/squelette";
import { PSEUDO_MAX_LENGTH } from "../../shared/protocol";
import { JOIN_MESSAGES, isCompleteCode, joinGame, playPath, readToken, validatePseudo, writeToken, type JoinFailure } from "./inscription";

interface GameApercu {
  titre: string;
  // Absent quand l'animateur n'a pas de nom affiché : on ne montre alors que le titre.
  animateur?: string;
}

interface Props {
  initialCode: string;
  // Résultat de la lecture serveur pour initialCode : connu dès l'arrivée, avant la saisie du pseudo.
  apercu?: GameApercu;
  echecInitial?: "game_not_found" | "game_finished";
}

type Phase = "verification" | "saisie" | "envoi";

// Erreurs qui concernent le code : elles s'affichent près du code, pas du pseudo.
const CODE_ERRORS: JoinFailure[] = ["game_not_found", "game_finished"];

export default function Rejoindre({ initialCode, apercu, echecInitial }: Props) {
  const [code, setCode] = useState(initialCode);
  const [pseudo, setPseudo] = useState("");
  // Avec un code complet, on regarde d'abord s'il existe un jeton : on ne montre pas le formulaire pour rien.
  const [phase, setPhase] = useState<Phase>(isCompleteCode(initialCode) ? "verification" : "saisie");
  const [failure, setFailure] = useState<JoinFailure | null>(echecInitial ?? null);
  const [pseudoError, setPseudoError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const labelId = useId();
  const aideId = useId();
  const codeErrorId = useId();

  useEffect(() => {
    if (phase !== "verification") return;
    if (readToken(window.localStorage, initialCode)) {
      window.location.replace(playPath(initialCode));
      return;
    }
    setPhase("saisie");
  }, [phase, initialCode]);

  // Retour par le cache avant/arrière : la page revient figée sur l'envoi, le formulaire resterait bloqué.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setPhase("saisie");
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  const changeCode = (value: string) => {
    setCode(value);
    setCodeError(null);
    if (failure && CODE_ERRORS.includes(failure)) setFailure(null);
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (phase === "envoi") return;
    setFailure(null);
    const nextCodeError = isCompleteCode(code) ? null : `Le code fait ${CODE_LENGTH} caractères.`;
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
    window.location.replace(playPath(code));
  };

  const encart =
    apercu && code === initialCode ? (
      <div className="mx-4 flex items-center gap-3 rounded-md border-trait border-vert-foret bg-creme p-4 shadow-relief-sm">
        <Forme forme="etoile" variante="soleil" className="size-14 shrink-0" aria-hidden="true">
          <BookOpen className="size-6" />
        </Forme>
        <div>
          <p className="font-affiche text-lg leading-tight">{apercu.titre}</p>
          {apercu.animateur ? (
            <p className="text-sm font-semibold text-vert-mousse">
              Animé par <b className="text-vert-foret">{apercu.animateur}</b>
            </p>
          ) : null}
        </div>
      </div>
    ) : null;

  if (phase === "verification") {
    return (
      <div className="flex flex-col gap-6">
        {encart}
        <div role="status" className="flex flex-col gap-4 px-5 py-2">
          <span className="sr-only">Chargement de ta partie</span>
          <Squelette className="h-20" />
          <Squelette className="h-14" />
        </div>
        {failure ? (
          <div className="px-5">
            <EtatErreur>{JOIN_MESSAGES[failure]}</EtatErreur>
          </div>
        ) : null}
      </div>
    );
  }

  const envoi = phase === "envoi";
  // Un code déjà annoncé inconnu ou terminé ne mène nulle part : le pseudo n'a pas de sens tant que le code n'est pas corrigé.
  const codeInutilisable = echecInitial !== undefined && failure === echecInitial && code === initialCode;

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      {encart}
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
          describedBy={codeError ? `${aideId} ${codeErrorId}` : aideId}
          autoFocus={!isCompleteCode(initialCode)}
        />
        <p id={aideId} className="mt-3 text-center text-sm font-semibold text-vert-mousse">
          {code === "" ? "Le code est affiché sur l'écran de l'animateur. Tu peux aussi le coller en entier." : "Tu peux aussi coller le code entier."}
        </p>
        {codeError ? (
          <p id={codeErrorId} role="alert" className="mt-3 text-center text-sm font-extrabold text-piment">
            {codeError}
          </p>
        ) : null}
      </Papier>

      <div className="flex flex-col gap-5 px-5">
        {failure ? (
          <EtatErreur onRetry={failure === "network" ? () => void submit() : undefined}>{JOIN_MESSAGES[failure]}</EtatErreur>
        ) : null}
        {codeInutilisable ? null : (
          <>
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
          </>
        )}
      </div>
    </form>
  );
}
