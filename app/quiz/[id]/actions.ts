"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import type {
  EditableQuestion,
  EditableQuiz,
} from "@/app/quiz/[id]/types";

export async function saveQuiz(
  quiz: EditableQuiz,
  questions: EditableQuestion[]
): Promise<{
  questionIdMap: { clientId: string; dbId: string }[];
  optionIdMap: { clientId: string; dbId: string }[];
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/connexion");
  }

  const { error: quizError } = await supabase
    .from("quizzes")
    .update({
      titre: quiz.titre,
      description: quiz.description || null,
      categorie: quiz.categorie || null,
      mode: quiz.mode,
      aleatoire_questions: quiz.aleatoire_questions,
      aleatoire_options: quiz.aleatoire_options,
      correction_immediate: quiz.correction_immediate,
      bonus_rapidite: quiz.bonus_rapidite,
    })
    .eq("id", quiz.id)
    .eq("auteur_id", user.id);

  if (quizError) {
    throw quizError;
  }

  const existingQuestionIds = questions
    .filter((q) => !q.isNew)
    .map((q) => q.id);
  const { data: serverQuestions } = await supabase
    .from("questions")
    .select("id")
    .eq("quiz_id", quiz.id);

  const idsToDelete =
    serverQuestions
      ?.map((q) => q.id as string)
      .filter((id) => !existingQuestionIds.includes(id)) ?? [];

  if (idsToDelete.length > 0) {
    await supabase.from("questions").delete().in("id", idsToDelete);
  }

  const questionIdMap: { clientId: string; dbId: string }[] = [];
  const optionIdMap: { clientId: string; dbId: string }[] = [];

  for (const question of questions) {
    const questionPayload = {
      quiz_id: quiz.id,
      ordre: question.ordre,
      type: question.type,
      enonce: question.enonce,
      duree_sec: question.duree_sec,
      points: question.points,
      reference_biblique: question.reference_biblique || null,
      explication: question.explication || null,
      indice: question.indice || null,
      reponses_texte: null,
    };

    let questionId = question.id;

    if (question.isNew) {
      const { data: inserted, error } = await supabase
        .from("questions")
        .insert(questionPayload)
        .select()
        .single();
      if (error || !inserted) {
        throw error ?? new Error("Impossible de créer la question");
      }
      questionId = inserted.id as string;
      questionIdMap.push({ clientId: question.id, dbId: questionId });
    } else {
      const { error } = await supabase
        .from("questions")
        .update(questionPayload)
        .eq("id", questionId)
        .eq("quiz_id", quiz.id);
      if (error) {
        throw error;
      }
    }

    const existingOptionIds = question.options
      .filter((o) => !o.isNew)
      .map((o) => o.id);
    const { data: serverOptions } = await supabase
      .from("options")
      .select("id")
      .eq("question_id", questionId);

    const optionIdsToDelete =
      serverOptions
        ?.map((o) => o.id as string)
        .filter((id) => !existingOptionIds.includes(id)) ?? [];

    if (optionIdsToDelete.length > 0) {
      await supabase.from("options").delete().in("id", optionIdsToDelete);
    }

    for (const option of question.options) {
      const optionPayload = {
        question_id: questionId,
        libelle: option.libelle,
        est_correcte: option.est_correcte,
        ordre: option.ordre,
      };

      if (option.isNew) {
        const { data: insertedOption, error } = await supabase
          .from("options")
          .insert(optionPayload)
          .select()
          .single();
        if (error || !insertedOption) {
          throw error ?? new Error("Impossible de créer l'option");
        }
        optionIdMap.push({
          clientId: option.id,
          dbId: insertedOption.id as string,
        });
      } else {
        const { error } = await supabase
          .from("options")
          .update(optionPayload)
          .eq("id", option.id)
          .eq("question_id", questionId);
        if (error) {
          throw error;
        }
      }
    }
  }

  revalidatePath(`/quiz/${quiz.id}`);
  revalidatePath("/tableau-de-bord");

  return { questionIdMap, optionIdMap };
}

export async function publishQuiz(quizId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/connexion");
  }

  const { error } = await supabase
    .from("quizzes")
    .update({ statut: "publie" })
    .eq("id", quizId)
    .eq("auteur_id", user.id);

  if (error) {
    throw error;
  }

  revalidatePath(`/quiz/${quizId}`);
  revalidatePath("/tableau-de-bord");
}
