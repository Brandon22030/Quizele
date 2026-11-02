import { titleSchema } from "../../shared/quiz-schema";
import { aDesMarques, validerQuestion, type Brouillon, type ChargeQuestion, type MarquesAEnvoyer } from "./modele";
import { effacerBrouillon, ecrireBrouillon, type Stockage } from "./stockage";

export const DELAI_ENREGISTREMENT_MS = 800;
export const DELAI_REPRISE_MS = 5_000;

export const MESSAGE_HORS_LIGNE = "Connexion perdue. Tes modifications sont gardées sur cet appareil et partiront dès que le réseau revient.";

export class ErreurApi extends Error {
  constructor(
    message: string,
    readonly options: { reseau?: boolean; code?: string } = {},
  ) {
    super(message);
  }
  get reseau(): boolean {
    return this.options.reseau === true;
  }
  get code(): string | undefined {
    return this.options.code;
  }
}

export const DELAI_REQUETE_MS = 15_000;

// Une requête sans réponse (réseau mobile qui décroche sans erreur) bloquerait la file pour toujours : passé le délai, elle
// compte comme une coupure réseau et la reprise automatique prend le relais.
export function avecDelaiMax<T>(requete: Promise<T>, message: string, delaiMs: number = DELAI_REQUETE_MS): Promise<T> {
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  const expiration = new Promise<never>((_, reject) => {
    minuterie = setTimeout(() => reject(new ErreurApi(message, { reseau: true })), delaiMs);
  });
  return Promise.race([requete, expiration]).finally(() => clearTimeout(minuterie));
}

// Les Actions vues de l'éditeur. Le vrai transport (astro:actions) vit dans api.ts, hors de portée des tests node.
export interface EditeurApi {
  creer(title: string): Promise<{ quizId: string }>;
  majTitre(quizId: string, title: string): Promise<void>;
  ajouterQuestion(quizId: string, question: ChargeQuestion): Promise<{ questionId: string }>;
  majQuestion(questionId: string, question: ChargeQuestion): Promise<void>;
  supprimerQuestion(questionId: string): Promise<void>;
  reordonner(quizId: string, questionIds: string[]): Promise<void>;
}

export type StatutEnreg = "enregistre" | "en_cours" | "echec" | "attente";

// Information qui ne bloque pas la file : le quiz a changé ailleurs, un rechargement montre la version du serveur.
export interface Avis {
  message: string;
  recharger: boolean;
}

export const AVIS_AUTRE_ONGLET = "Ce quiz est ouvert dans un autre onglet. Recharge pour voir ses changements.";

export interface Instantane {
  brouillon: Brouillon;
  statut: StatutEnreg;
  message: string | null;
  horsLigne: boolean;
  code: string | null;
  avis: Avis | null;
}

interface Options {
  api: EditeurApi;
  stockage: Stockage | null;
  brouillon: Brouillon;
  delaiMs?: number;
  delaiRepriseMs?: number;
  // Identifiant de l'onglet pour un quiz pas encore créé : range le brouillon sous une clé propre à cet onglet.
  session?: string | null;
  // Appelé une fois, quand le quiz vient d'être créé côté serveur (l'écran remplace /quiz/nouveau par /quiz/<id>).
  surCreation?: (quizId: string) => void;
  // Appelé après chaque écriture confirmée par le serveur : les autres onglets ouverts sur ce quiz en sont prévenus.
  surEcriture?: () => void;
}

const sans = (sale: MarquesAEnvoyer, cle: string): MarquesAEnvoyer => ({ ...sale, questions: sale.questions.filter((k) => k !== cle) });

// File d'enregistrement : regroupe les modifications (800 ms), les écrit d'abord dans localStorage, puis les envoie dans l'ordre
// créer, titre, suppressions, questions, ordre. Un échec réseau laisse tout en place et relance l'envoi tout seul.
export class FileEnregistrement {
  private b: Brouillon;
  private snap: Instantane;
  private readonly api: EditeurApi;
  private readonly stockage: Stockage | null;
  private readonly delaiMs: number;
  private readonly delaiRepriseMs: number;
  private readonly session: string | null;
  private readonly surCreation?: (quizId: string) => void;
  private readonly surEcriture?: () => void;
  private readonly ecouteurs = new Set<() => void>();
  private minuterie: ReturnType<typeof setTimeout> | null = null;
  private reprise: ReturnType<typeof setTimeout> | null = null;
  private vidage: Promise<boolean> | null = null;
  private encore = false;
  private arrete = false;

  constructor(options: Options) {
    this.api = options.api;
    this.stockage = options.stockage;
    this.b = options.brouillon;
    this.delaiMs = options.delaiMs ?? DELAI_ENREGISTREMENT_MS;
    this.delaiRepriseMs = options.delaiRepriseMs ?? DELAI_REPRISE_MS;
    this.surCreation = options.surCreation;
    this.surEcriture = options.surEcriture;
    this.session = options.session ?? null;
    this.snap = { brouillon: this.b, statut: "enregistre", message: null, horsLigne: false, code: null, avis: null };
  }

  // Fonctions fléchées : passées telles quelles à useSyncExternalStore.
  instantane = (): Instantane => this.snap;

  abonner = (ecouteur: () => void): (() => void) => {
    this.ecouteurs.add(ecouteur);
    return () => {
      this.ecouteurs.delete(ecouteur);
    };
  };

  // À appeler après un chargement avec un brouillon repris de localStorage : envoie sans attendre la prochaine frappe.
  demarrer(): void {
    if (aDesMarques(this.b)) {
      this.publier({ statut: "en_cours" });
      void this.vider();
    }
  }

  modifier(fn: (b: Brouillon) => Brouillon): void {
    const suivant = fn(this.b);
    if (suivant === this.b) return;
    this.b = suivant;
    // Le disque d'abord : le réseau peut tomber ou la page se fermer avant la réponse du serveur.
    this.ecrire(this.b);
    this.encore = true;
    this.publier({ statut: "en_cours", message: null, horsLigne: false, code: null });
    this.planifier();
  }

  vider(): Promise<boolean> {
    this.annulerMinuterie();
    this.annulerReprise();
    if (this.vidage) {
      this.encore = true;
      return this.vidage;
    }
    this.vidage = this.boucle().finally(() => {
      this.vidage = null;
    });
    return this.vidage;
  }

  // « Réessayer maintenant » et retour du réseau.
  relancer(): Promise<boolean> {
    this.publier({ statut: "en_cours", message: null, horsLigne: false, code: null });
    return this.vider();
  }

  signaler(avis: Avis | null): void {
    if (avis?.message === this.snap.avis?.message && avis?.recharger === this.snap.avis?.recharger) return;
    this.publier({ avis });
  }

  arreter(): void {
    this.arrete = true;
    this.annulerMinuterie();
    this.annulerReprise();
    this.ecouteurs.clear();
  }

  private ecrire(b: Brouillon): void {
    ecrireBrouillon(this.stockage, b, b.quizId === null ? this.session : null);
  }

  private async ecrireServeur<T>(envoi: () => Promise<T>): Promise<T> {
    const resultat = await envoi();
    this.surEcriture?.();
    return resultat;
  }

  private publier(partiel: Partial<Omit<Instantane, "brouillon">> = {}): void {
    this.snap = { ...this.snap, ...partiel, brouillon: this.b };
    this.ecouteurs.forEach((e) => e());
  }

  private planifier(): void {
    this.annulerMinuterie();
    this.minuterie = setTimeout(() => {
      this.minuterie = null;
      void this.vider();
    }, this.delaiMs);
  }

  private annulerMinuterie(): void {
    if (this.minuterie) clearTimeout(this.minuterie);
    this.minuterie = null;
  }

  private annulerReprise(): void {
    if (this.reprise) clearTimeout(this.reprise);
    this.reprise = null;
  }

  private async boucle(): Promise<boolean> {
    for (;;) {
      this.encore = false;
      const ok = await this.passe();
      if (!ok || !this.encore || this.arrete) return ok;
    }
  }

  // Remplace le brouillon sans relancer d'envoi : utilisé pour consigner une réussite.
  private consigner(b: Brouillon): void {
    this.b = b;
    if (aDesMarques(b)) this.ecrire(b);
    this.publier();
  }

  private async passe(): Promise<boolean> {
    this.publier({ statut: "en_cours" });
    try {
      const bloque = await this.synchroniser();
      if (this.arrete) return true;
      if (bloque) {
        this.publier({ statut: "attente", message: bloque, horsLigne: false, code: null });
        return true;
      }
      if (aDesMarques(this.b)) {
        // Des modifications sont arrivées pendant l'envoi : la boucle repart.
        this.encore = true;
        return true;
      }
      effacerBrouillon(this.stockage, this.b.quizId, this.session);
      this.publier({ statut: "enregistre", message: null, horsLigne: false, code: null });
      return true;
    } catch (erreur) {
      if (this.arrete) return false;
      const e = erreur instanceof ErreurApi ? erreur : new ErreurApi("L'enregistrement a échoué. Réessaie dans un instant.");
      this.publier({ statut: "echec", message: e.reseau ? MESSAGE_HORS_LIGNE : e.message, horsLigne: e.reseau, code: e.code ?? null });
      if (e.reseau) {
        this.reprise = setTimeout(() => {
          this.reprise = null;
          void this.vider();
        }, this.delaiRepriseMs);
      }
      return false;
    }
  }

  // Renvoie un message si une règle empêche d'aller plus loin sans erreur du serveur (titre vide, question invalide).
  private async synchroniser(): Promise<string | null> {
    let bloque: string | null = null;

    const titreValide = titleSchema.safeParse(this.b.title).success;
    if (!titreValide && (this.b.sale.titre || this.b.quizId === null) && aDesMarques(this.b)) {
      bloque = this.b.quizId === null ? "Ajoute un titre pour enregistrer ton quiz." : "Le titre ne peut pas être vide.";
    }

    if (this.b.quizId === null) {
      if (!titreValide) return bloque;
      const titre = this.b.title.trim();
      const { quizId } = await this.ecrireServeur(() => this.api.creer(titre));
      // La clé de stockage change avec l'identifiant : l'ancien brouillon « nouveau » ne doit pas ressusciter au prochain passage.
      effacerBrouillon(this.stockage, null, this.session);
      this.b = { ...this.b, quizId, sale: { ...this.b.sale, titre: this.b.title.trim() !== titre } };
      this.ecrire(this.b);
      this.publier();
      this.surCreation?.(quizId);
    } else if (this.b.sale.titre && titreValide) {
      const quizId = this.b.quizId;
      const envoye = this.b.title.trim();
      await this.ecrireServeur(() => this.api.majTitre(quizId, envoye));
      this.consigner({ ...this.b, sale: { ...this.b.sale, titre: this.b.title.trim() !== envoye } });
    }

    const quizId = this.b.quizId;
    if (quizId === null) return bloque;

    for (const id of [...this.b.sale.supprimees]) {
      try {
        await this.ecrireServeur(() => this.api.supprimerQuestion(id));
      } catch (erreur) {
        // Déjà supprimée ailleurs : le résultat voulu est atteint.
        if (!(erreur instanceof ErreurApi && erreur.code === "NOT_FOUND")) throw erreur;
      }
      this.consigner({ ...this.b, sale: { ...this.b.sale, supprimees: this.b.sale.supprimees.filter((s) => s !== id) } });
    }

    for (const cle of [...this.b.sale.questions]) {
      const q = this.b.questions.find((x) => x.key === cle);
      if (!q) {
        this.consigner({ ...this.b, sale: sans(this.b.sale, cle) });
        continue;
      }
      const validation = validerQuestion(q);
      if (!validation.ok) {
        const rang = this.b.questions.indexOf(q) + 1;
        bloque ??= `Corrige la question ${rang} pour l'enregistrer : ${validation.message}`;
        continue;
      }
      let id = q.id;
      if (id === null) {
        ({ questionId: id } = await this.ecrireServeur(() => this.api.ajouterQuestion(quizId, validation.question)));
        if (!this.b.questions.some((x) => x.key === cle)) {
          // Supprimée pendant l'envoi : elle existe maintenant sur le serveur, la suppression part au tour suivant.
          this.consigner({ ...this.b, sale: { ...sans(this.b.sale, cle), supprimees: [...this.b.sale.supprimees, id] } });
          continue;
        }
      } else {
        const questionId = id;
        try {
          await this.ecrireServeur(() => this.api.majQuestion(questionId, validation.question));
        } catch (erreur) {
          if (!(erreur instanceof ErreurApi && erreur.code === "NOT_FOUND")) throw erreur;
          // Supprimée ailleurs (autre onglet, autre appareil) : la renvoyer échouerait toujours, le reste de la file continue.
          const rang = this.b.questions.findIndex((x) => x.key === cle) + 1;
          this.consigner({ ...this.b, sale: sans(this.b.sale, cle) });
          this.publier({
            avis: { message: `La question ${rang} a été supprimée ailleurs. Recharge pour voir le quiz à jour.`, recharger: true },
          });
          continue;
        }
      }
      // Même référence = rien n'a changé pendant l'envoi ; sinon la marque reste et la boucle renverra la version récente.
      const inchangee = this.b.questions.find((x) => x.key === cle) === q;
      const questions = this.b.questions.map((x) => (x.key === cle ? { ...x, id } : x));
      const sale = inchangee ? sans(this.b.sale, cle) : this.b.sale;
      // Le serveur ajoute en fin de liste, comme l'éditeur : seul un déplacement ou une copie insérée marque l'ordre.
      this.consigner({ ...this.b, questions, sale });
    }

    // L'API exige la liste complète : tant qu'une question n'a pas d'identifiant, l'ordre attend.
    if (this.b.sale.ordre && this.b.questions.every((q) => q.id !== null) && this.b.sale.supprimees.length === 0) {
      const ids = this.b.questions.map((q) => q.id as string);
      try {
        await this.ecrireServeur(() => this.api.reordonner(quizId, ids));
      } catch (erreur) {
        if (!(erreur instanceof ErreurApi && erreur.code === "BAD_REQUEST")) throw erreur;
        // La liste du serveur a changé ailleurs : renvoyer le même ordre échouerait toujours. On l'abandonne et on le dit.
        this.consigner({ ...this.b, sale: { ...this.b.sale, ordre: false } });
        this.publier({ avis: { message: erreur.message, recharger: true } });
        return bloque;
      }
      const inchange = this.b.questions.map((q) => q.id).join("|") === ids.join("|");
      this.consigner({ ...this.b, sale: { ...this.b.sale, ordre: !inchange } });
    }

    return bloque;
  }
}
