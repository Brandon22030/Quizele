"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronDown, ChevronUp, Copy, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Rubrique } from "@/components/ui/rubrique";
import { RuleFrame } from "@/components/ui/rule-frame";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { CoverUpload } from "@/components/ui/cover-upload";
import {
  publishQuiz,
  saveQuiz,
} from "@/app/quiz/[id]/actions";
import type {
  EditableOption,
  EditableQuestion,
  EditableQuiz,
  ValidationError,
} from "@/app/quiz/[id]/types";

function generateId() {
  return crypto.randomUUID();
}

function createDefaultOptions(type: EditableQuestion["type"]): EditableOption[] {
  if (type === "vrai_faux") {
    return [
      { id: generateId(), libelle: "Vrai", est_correcte: true, ordre: 1, isNew: true },
      { id: generateId(), libelle: "Faux", est_correcte: false, ordre: 2, isNew: true },
    ];
  }
  return [
    { id: generateId(), libelle: "", est_correcte: true, ordre: 1, isNew: true },
    { id: generateId(), libelle: "", est_correcte: false, ordre: 2, isNew: true },
  ];
}

function buildEditableQuiz(raw: Record<string, unknown>): EditableQuiz {
  return {
    id: raw.id as string,
    titre: (raw.titre as string) ?? "",
    description: (raw.description as string) ?? "",
    categorie: (raw.categorie as string) ?? "",
    couverture_url: (raw.couverture_url as string | null) ?? null,
    mode: (raw.mode as EditableQuiz["mode"]) ?? "libre",
    aleatoire_questions: (raw.aleatoire_questions as boolean) ?? false,
    aleatoire_options: (raw.aleatoire_options as boolean) ?? false,
    correction_immediate: (raw.correction_immediate as boolean) ?? true,
    bonus_rapidite: (raw.bonus_rapidite as boolean) ?? false,
    statut: (raw.statut as EditableQuiz["statut"]) ?? "brouillon",
  };
}

function buildEditableQuestions(
  raw: Record<string, unknown>[]
): EditableQuestion[] {
  return raw.map((q, index) => {
    const rawOptions = ((q.options as Record<string, unknown>[]) ?? []).sort(
      (a, b) => (a.ordre as number) - (b.ordre as number)
    );

    return {
      id: q.id as string,
      enonce: (q.enonce as string) ?? "",
      type: (q.type as EditableQuestion["type"]) ?? "unique",
      duree_sec: (q.duree_sec as number) ?? 20,
      points: (q.points as number) ?? 100,
      reference_biblique: (q.reference_biblique as string | null) ?? null,
      explication: (q.explication as string | null) ?? null,
      indice: (q.indice as string | null) ?? null,
      ordre: index + 1,
      options: rawOptions.map((o) => ({
        id: o.id as string,
        libelle: (o.libelle as string) ?? "",
        est_correcte: (o.est_correcte as boolean) ?? false,
        ordre: (o.ordre as number) ?? 1,
      })),
    };
  });
}

function validateQuiz(questions: EditableQuestion[]): ValidationError[] {
  const errors: ValidationError[] = [];

  if (questions.length === 0) {
    errors.push({ questionId: "", message: "Ajoute au moins une question." });
  }

  for (const question of questions) {
    if (!question.enonce.trim()) {
      errors.push({
        questionId: question.id,
        message: "L'énoncé est vide.",
      });
    }

    const hasCorrect = question.options.some((o) => o.est_correcte);
    if (!hasCorrect) {
      errors.push({
        questionId: question.id,
        message: "Il manque une bonne réponse.",
      });
    }

    if (question.type === "vrai_faux" && question.options.length !== 2) {
      errors.push({
        questionId: question.id,
        message: "Une question vrai/faux doit avoir deux propositions.",
      });
    }
  }

  return errors;
}

export function QuizEditor({
  quiz: rawQuiz,
  questions: rawQuestions,
  quizId,
}: {
  quiz: Record<string, unknown>;
  questions: Record<string, unknown>[];
  quizId: string;
  userId: string;
}) {
  const [quiz, setQuiz] = useState<EditableQuiz>(() =>
    buildEditableQuiz(rawQuiz)
  );
  const [questions, setQuestions] = useState<EditableQuestion[]>(() =>
    buildEditableQuestions(rawQuestions)
  );
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(
    questions[0]?.id ?? null
  );
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "dirty">(
    "saved"
  );
  const [isPublishing, startPublishing] = useTransition();
  const { addToast } = useToast();

  useEffect(() => {
    let cancelled = false;
    const raf = requestAnimationFrame(() => setSaveStatus("dirty"));
    const timer = setTimeout(async () => {
      if (cancelled) return;
      setSaveStatus("saving");
      try {
        await saveQuiz(quiz, questions);
        if (!cancelled) {
          setSaveStatus("saved");
        }
      } catch (error) {
        if (!cancelled) {
          setSaveStatus("dirty");
          addToast({
            title: "Erreur d'enregistrement",
            description:
              error instanceof Error ? error.message : "Réessayez plus tard.",
            variant: "error",
          });
        }
      }
    }, 800);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [quiz, questions, addToast]);

  function updateQuiz<K extends keyof EditableQuiz>(
    field: K,
    value: EditableQuiz[K]
  ) {
    setQuiz((prev) => ({ ...prev, [field]: value }));
  }

  function addQuestion() {
    const newQuestion: EditableQuestion = {
      id: generateId(),
      enonce: "",
      type: "unique",
      duree_sec: 20,
      points: 100,
      reference_biblique: null,
      explication: null,
      indice: null,
      ordre: questions.length + 1,
      options: createDefaultOptions("unique"),
      isNew: true,
    };
    setQuestions((prev) => [...prev, newQuestion]);
    setSelectedQuestionId(newQuestion.id);
  }

  function duplicateQuestion(id: string) {
    const source = questions.find((q) => q.id === id);
    if (!source) return;

    const duplicated: EditableQuestion = {
      ...source,
      id: generateId(),
      enonce: `${source.enonce} (copie)`,
      ordre: questions.length + 1,
      options: source.options.map((o) => ({ ...o, id: generateId(), isNew: true })),
      isNew: true,
    };
    setQuestions((prev) => [...prev, duplicated]);
    setSelectedQuestionId(duplicated.id);
  }

  function deleteQuestion(id: string) {
    if (!window.confirm("Supprimer cette question ?")) return;

    setQuestions((prev) => {
      const next = prev.filter((q) => q.id !== id);
      return next.map((q, index) => ({ ...q, ordre: index + 1 }));
    });

    if (selectedQuestionId === id) {
      setSelectedQuestionId(null);
    }
  }

  function moveQuestion(id: string, direction: "up" | "down") {
    setQuestions((prev) => {
      const index = prev.findIndex((q) => q.id === id);
      if (index === -1) return prev;
      if (direction === "up" && index === 0) return prev;
      if (direction === "down" && index === prev.length - 1) return prev;

      const next = [...prev];
      const swapWith = direction === "up" ? index - 1 : index + 1;
      const temp = next[index];
      next[index] = next[swapWith];
      next[swapWith] = temp;

      return next.map((q, i) => ({ ...q, ordre: i + 1 }));
    });
  }

  function updateQuestion(id: string, updates: Partial<EditableQuestion>) {
    setQuestions((prev) =>
      prev.map((q) => {
        if (q.id !== id) return q;

        const next = { ...q, ...updates };

        if (updates.type && updates.type !== q.type) {
          return { ...next, options: createDefaultOptions(updates.type) };
        }

        return next;
      })
    );
  }

  function updateOption(
    questionId: string,
    optionId: string,
    updates: Partial<EditableOption>
  ) {
    setQuestions((prev) =>
      prev.map((q) => {
        if (q.id !== questionId) return q;

        const options = q.options.map((o) => {
          if (o.id !== optionId) return o;
          const next = { ...o, ...updates };

          if (
            "est_correcte" in updates &&
            updates.est_correcte &&
            q.type === "unique"
          ) {
            return next;
          }
          return next;
        });

        if (
          "est_correcte" in updates &&
          updates.est_correcte &&
          q.type === "unique"
        ) {
          return {
            ...q,
            options: options.map((o) =>
              o.id === optionId ? o : { ...o, est_correcte: false }
            ),
          };
        }

        return { ...q, options };
      })
    );
  }

  function addOption(questionId: string) {
    setQuestions((prev) =>
      prev.map((q) => {
        if (q.id !== questionId || q.type === "vrai_faux") return q;
        return {
          ...q,
          options: [
            ...q.options,
            {
              id: generateId(),
              libelle: "",
              est_correcte: false,
              ordre: q.options.length + 1,
              isNew: true,
            },
          ],
        };
      })
    );
  }

  function deleteOption(questionId: string, optionId: string) {
    setQuestions((prev) =>
      prev.map((q) => {
        if (q.id !== questionId || q.type === "vrai_faux") return q;
        const nextOptions = q.options.filter((o) => o.id !== optionId);
        if (nextOptions.length < 2) return q;
        return {
          ...q,
          options: nextOptions.map((o, i) => ({ ...o, ordre: i + 1 })),
        };
      })
    );
  }

  function handlePublish() {
    const errors = validateQuiz(questions);
    if (errors.length > 0) {
      addToast({
        title: "Publication impossible",
        description: errors.map((e) => e.message).join(" "),
        variant: "error",
      });
      return;
    }

    startPublishing(async () => {
      try {
        await saveQuiz(quiz, questions);
        await publishQuiz(quizId);
        addToast({
          title: "Quiz publié",
          variant: "success",
        });
      } catch (error) {
        addToast({
          title: "Erreur de publication",
          description:
            error instanceof Error ? error.message : "Réessayez plus tard.",
          variant: "error",
        });
      }
    });
  }

  const selectedQuestion = questions.find((q) => q.id === selectedQuestionId);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-adire bg-background px-4 py-3">
        <div className="flex items-center gap-3">
          <Link href="/tableau-de-bord" className="inline-flex size-10 items-center justify-center rounded-sm text-foreground transition-colors hover:bg-adire/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ArrowLeft className="size-4" aria-hidden="true" />
            <span className="sr-only">Retour</span>
          </Link>
          <h1 className="font-display text-lg text-foreground sm:text-xl">
            {quiz.titre || "Sans titre"}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {saveStatus === "saving" && "Enregistrement…"}
            {saveStatus === "saved" && "Enregistré"}
            {saveStatus === "dirty" && "Modifications en cours…"}
          </span>
          <Button
            variant="primary"
            size="md"
            loading={isPublishing}
            onClick={handlePublish}
            disabled={quiz.statut === "publie"}
          >
            {quiz.statut === "publie" ? "Publié" : "Publier"}
          </Button>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
        {/* Colonne de gauche : questions */}
        <section className="border-b border-adire p-4 lg:border-b-0 lg:border-r">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-xl text-foreground">Questions</h2>
            <Button variant="secondary" size="md" onClick={addQuestion}>
              <Plus className="size-4" aria-hidden="true" />
              Ajouter
            </Button>
          </div>

          <div className="space-y-3">
            {questions.map((q, index) => (
              <RuleFrame
                key={q.id}
                className={`cursor-pointer rounded-md border bg-card p-4 text-card-foreground transition-colors ${
                  selectedQuestionId === q.id
                    ? "border-indigo"
                    : "border-adire"
                }`}
                position="left"
                ruleClassName={
                  selectedQuestionId === q.id ? "bg-or" : "bg-indigo"
                }
                onClick={() => setSelectedQuestionId(q.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <Rubrique>Question {index + 1}</Rubrique>
                    <p className="truncate text-base text-foreground">
                      {q.enonce || "Nouvelle question"}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="md"
                      aria-label="Monter la question"
                      onClick={(event) => {
                        event.stopPropagation();
                        moveQuestion(q.id, "up");
                      }}
                      disabled={index === 0}
                    >
                      <ChevronUp className="size-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="md"
                      aria-label="Descendre la question"
                      onClick={(event) => {
                        event.stopPropagation();
                        moveQuestion(q.id, "down");
                      }}
                      disabled={index === questions.length - 1}
                    >
                      <ChevronDown className="size-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="md"
                      aria-label="Dupliquer la question"
                      onClick={(event) => {
                        event.stopPropagation();
                        duplicateQuestion(q.id);
                      }}
                    >
                      <Copy className="size-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="md"
                      aria-label="Supprimer la question"
                      className="text-rubrique hover:text-rubrique"
                      onClick={(event) => {
                        event.stopPropagation();
                        deleteQuestion(q.id);
                      }}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              </RuleFrame>
            ))}
          </div>
        </section>

        {/* Colonne de droite : édition */}
        <section className="space-y-6 overflow-y-auto p-4">
          <Card className="space-y-4">
            <h2 className="font-display text-lg text-foreground">
              Métadonnées du quiz
                </h2>
                <FormField id="titre" label="Titre">
                  <Input
                    id="titre"
                    value={quiz.titre}
                    onChange={(event) => updateQuiz("titre", event.target.value)}
                    placeholder="Titre du quiz"
                  />
                </FormField>
                <FormField id="description" label="Description">
                  <Textarea
                    id="description"
                    value={quiz.description}
                    onChange={(event) =>
                      updateQuiz("description", event.target.value)
                    }
                    placeholder="De quoi parle ce quiz ?"
                  />
                </FormField>
                <FormField id="categorie" label="Catégorie">
                  <Input
                    id="categorie"
                    value={quiz.categorie}
                    onChange={(event) =>
                      updateQuiz("categorie", event.target.value)
                    }
                    placeholder="Par exemple : Nouveau Testament"
                  />
                </FormField>
                <FormField id="couverture" label="Image de couverture">
                  <CoverUpload
                    value={quiz.couverture_url}
                    onChange={(url) => updateQuiz("couverture_url", url)}
                  />
                </FormField>
              </Card>

              <Card className="space-y-4">
                <h2 className="font-display text-lg text-foreground">
                  Paramètres
                </h2>
                <fieldset className="space-y-3">
                  <legend className="text-sm font-medium text-foreground">
                    Déroulement
                  </legend>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="mode"
                      checked={quiz.mode === "libre"}
                      onChange={() => updateQuiz("mode", "libre")}
                    />
                    <span>Chacun avance à son rythme</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="mode"
                      checked={quiz.mode === "synchronise"}
                      onChange={() => updateQuiz("mode", "synchronise")}
                    />
                    <span>Je pilote question par question</span>
                  </label>
                </fieldset>

                <div className="space-y-2">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={quiz.aleatoire_questions}
                      onChange={(event) =>
                        updateQuiz("aleatoire_questions", event.target.checked)
                      }
                    />
                    <span>Mélanger l&apos;ordre des questions</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={quiz.aleatoire_options}
                      onChange={(event) =>
                        updateQuiz("aleatoire_options", event.target.checked)
                      }
                    />
                    <span>Mélanger les propositions</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={quiz.correction_immediate}
                      onChange={(event) =>
                        updateQuiz("correction_immediate", event.target.checked)
                      }
                    />
                    <span>Montrer la correction après chaque question</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={quiz.bonus_rapidite}
                      onChange={(event) =>
                        updateQuiz("bonus_rapidite", event.target.checked)
                      }
                    />
                    <span>Récompenser la rapidité</span>
                  </label>
                </div>
              </Card>

              {selectedQuestion && (
                <Card className="space-y-4">
                  <h2 className="font-display text-lg text-foreground">
                    Édition de la question
                  </h2>
                  <FormField id="enonce" label="Énoncé">
                  <Textarea
                    id="enonce"
                    value={selectedQuestion.enonce}
                    onChange={(event) =>
                      updateQuestion(selectedQuestion.id, {
                        enonce: event.target.value,
                      })
                    }
                    placeholder="Quelle est la question ?"
                  />
                </FormField>

                <div className="grid grid-cols-2 gap-4">
                  <FormField id="type" label="Type de réponse">
                    <select
                      id="type"
                      value={selectedQuestion.type}
                      onChange={(event) =>
                        updateQuestion(selectedQuestion.id, {
                          type: event.target.value as EditableQuestion["type"],
                        })
                      }
                      className="w-full rounded-sm border border-input bg-card px-3 py-2 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <option value="unique">Choix unique</option>
                      <option value="multiple">Choix multiples</option>
                      <option value="vrai_faux">Vrai / Faux</option>
                    </select>
                  </FormField>

                  <FormField id="duree" label="Temps de réponse">
                    <select
                      id="duree"
                      value={selectedQuestion.duree_sec}
                      onChange={(event) =>
                        updateQuestion(selectedQuestion.id, {
                          duree_sec: Number(event.target.value),
                        })
                      }
                      className="w-full rounded-sm border border-input bg-card px-3 py-2 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <option value={10}>10s</option>
                      <option value={15}>15s</option>
                      <option value={20}>20s</option>
                      <option value={30}>30s</option>
                      <option value={60}>60s</option>
                    </select>
                  </FormField>

                  <FormField id="points" label="Points">
                    <Input
                      id="points"
                      type="number"
                      min={0}
                      value={selectedQuestion.points}
                      onChange={(event) =>
                        updateQuestion(selectedQuestion.id, {
                          points: Number(event.target.value),
                        })
                      }
                    />
                  </FormField>

                  <FormField id="reference" label="Référence biblique">
                    <Input
                      id="reference"
                      value={selectedQuestion.reference_biblique ?? ""}
                      onChange={(event) =>
                        updateQuestion(selectedQuestion.id, {
                          reference_biblique: event.target.value || null,
                        })
                      }
                      placeholder="Jean 3,16"
                    />
                  </FormField>
                </div>

                <FormField id="indice" label="Indice (optionnel)">
                  <Input
                    id="indice"
                    value={selectedQuestion.indice ?? ""}
                    onChange={(event) =>
                      updateQuestion(selectedQuestion.id, {
                        indice: event.target.value || null,
                      })
                    }
                    placeholder="Un petit coup de pouce"
                  />
                </FormField>

                <FormField
                  id="explication"
                  label="Explication"
                  help="Texte affiché lors de la correction. C'est là que se joue la valeur pédagogique du quiz."
                >
                  <Textarea
                    id="explication"
                    value={selectedQuestion.explication ?? ""}
                    onChange={(event) =>
                      updateQuestion(selectedQuestion.id, {
                        explication: event.target.value || null,
                      })
                    }
                    placeholder="Pourquoi cette réponse est la bonne..."
                  />
                </FormField>

                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-foreground">
                    Propositions
                  </h3>
                  {selectedQuestion.options.map((option) => (
                    <div
                      key={option.id}
                      className="flex items-center gap-2"
                    >
                      <input
                        type={
                          selectedQuestion.type === "multiple"
                            ? "checkbox"
                            : "radio"
                        }
                        name={`correct-${selectedQuestion.id}`}
                        aria-label="Marquer comme bonne réponse"
                        className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        checked={option.est_correcte}
                        onChange={() =>
                          updateOption(selectedQuestion.id, option.id, {
                            est_correcte: true,
                          })
                        }
                      />
                      <Input
                        value={option.libelle}
                        onChange={(event) =>
                          updateOption(selectedQuestion.id, option.id, {
                            libelle: event.target.value,
                          })
                        }
                        placeholder="Proposition"
                        disabled={selectedQuestion.type === "vrai_faux"}
                      />
                      {selectedQuestion.type !== "vrai_faux" && (
                        <Button
                          variant="ghost"
                          size="md"
                          aria-label="Supprimer la proposition"
                          className="text-rubrique hover:text-rubrique"
                          onClick={() =>
                            deleteOption(selectedQuestion.id, option.id)
                          }
                          disabled={selectedQuestion.options.length <= 2}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                  ))}
                  {selectedQuestion.type !== "vrai_faux" && (
                    <Button
                      variant="ghost"
                      size="md"
                      onClick={() => addOption(selectedQuestion.id)}
                    >
                      <Plus className="size-4" aria-hidden="true" />
                      Ajouter une proposition
                    </Button>
                  )}
                </div>
              </Card>
            )}
          {!selectedQuestion && (
            <Card className="p-8 text-center text-muted-foreground">
              <p className="font-display text-lg text-foreground">
                Sélectionne une question pour l&apos;éditer
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                Choisis une question dans la liste de gauche, ou ajoutes-en une nouvelle.
              </p>
            </Card>
          )}
        </section>
      </main>
    </div>
  );
}
