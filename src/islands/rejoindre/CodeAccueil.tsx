import { useId, useState, type FormEvent } from "react";
import { sanitizeCode, CODE_LENGTH } from "../../components/jeu/code-input";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Ticket } from "../../components/ui/ticket";

// Seul JavaScript de l'accueil : le champ du ticket mène à la page de la partie.
export default function CodeAccueil() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const errorId = useId();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (code.length !== CODE_LENGTH) {
      setError(code === "" ? "Saisis le code donné par l'animateur." : "Le code fait 6 caractères.");
      return;
    }
    setSending(true);
    window.location.assign(`/j/${code}`);
  };

  return (
    <Ticket className="mx-5">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4 px-4 py-4 text-center">
        <h2 className="font-affiche text-2xl text-jaune-soleil">Tu as un code ?</h2>
        <label htmlFor="code-accueil" className="sr-only">
          Code de la partie
        </label>
        <Input
          id="code-accueil"
          value={code}
          onChange={(e) => {
            setCode(sanitizeCode(e.target.value).slice(0, CODE_LENGTH));
            setError(null);
          }}
          placeholder="ABC234"
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="min-h-16 text-center font-affiche text-2xl tracking-widest uppercase"
        />
        {error ? (
          <p id={errorId} role="alert" className="self-center rounded-sm bg-creme px-3 py-1 text-sm font-extrabold text-piment">
            {error}
          </p>
        ) : null}
        <Button type="submit" variante="soleil" bloc chargement={sending} libelleChargement="Ouverture de la partie">
          Rejoindre la partie
        </Button>
      </form>
    </Ticket>
  );
}
