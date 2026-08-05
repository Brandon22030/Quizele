"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export async function deleteQuiz(quizId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    throw new Error("Vous devez être connecté");
  }

  const { error: deleteError } = await supabase
    .from("quizzes")
    .delete()
    .eq("id", quizId)
    .eq("auteur_id", data.user.id);

  if (deleteError) {
    throw deleteError;
  }

  revalidatePath("/tableau-de-bord");
}

export async function duplicateQuiz(quizId: string) {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) {
    throw new Error("Vous devez être connecté");
  }

  const { data: quiz, error: quizError } = await supabase
    .from("quizzes")
    .select("*")
    .eq("id", quizId)
    .eq("auteur_id", authData.user.id)
    .single();

  if (quizError || !quiz) {
    throw new Error("Quiz introuvable");
  }

  const { data: questions, error: questionsError } = await supabase
    .from("questions")
    .select("*, options(*)")
    .eq("quiz_id", quizId)
    .order("ordre", { ascending: true });

  if (questionsError) {
    throw questionsError;
  }

  const { data: newQuiz, error: createError } = await supabase
    .from("quizzes")
    .insert({
      auteur_id: authData.user.id,
      titre: `${quiz.titre} (copie)`,
      description: quiz.description,
      categorie: quiz.categorie,
      mode: quiz.mode,
      aleatoire_questions: quiz.aleatoire_questions,
      aleatoire_options: quiz.aleatoire_options,
      correction_immediate: quiz.correction_immediate,
      bonus_rapidite: quiz.bonus_rapidite,
      visibilite: "lien",
      statut: "brouillon",
    })
    .select()
    .single();

  if (createError || !newQuiz) {
    throw createError;
  }

  for (const question of questions ?? []) {
    const { data: newQuestion, error: questionError } = await supabase
      .from("questions")
      .insert({
        quiz_id: newQuiz.id,
        ordre: question.ordre,
        type: question.type,
        enonce: question.enonce,
        image_url: question.image_url,
        duree_sec: question.duree_sec,
        points: question.points,
        reference_biblique: question.reference_biblique,
        explication: question.explication,
        indice: question.indice,
        reponses_texte: question.reponses_texte,
      })
      .select()
      .single();

    if (questionError || !newQuestion) {
      throw questionError;
    }

    const options = question.options ?? [];
    if (options.length > 0) {
      const { error: optionsError } = await supabase.from("options").insert(
        options.map((option: Record<string, unknown>) => ({
          question_id: newQuestion.id,
          libelle: option.libelle,
          est_correcte: option.est_correcte,
          ordre: option.ordre,
        }))
      );

      if (optionsError) {
        throw optionsError;
      }
    }
  }

  revalidatePath("/tableau-de-bord");
  return newQuiz.id;
}

export async function createSampleQuiz() {
  try {
    const supabase = await createClient();
    const { data: authData, error: authError } = await supabase.auth.getUser();

    if (authError || !authData.user) {
      throw new Error("Vous devez être connecté");
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", authData.user.id)
      .maybeSingle();

    if (!profile) {
      const { error: profileError } = await supabase.from("profiles").insert({
        id: authData.user.id,
        pseudo: authData.user.email ?? "Créateur",
      });
      if (profileError) {
        throw new Error(profileError.message);
      }
    }

    const { data: quiz, error: quizError } = await supabase
      .from("quizzes")
      .insert({
      auteur_id: authData.user.id,
      titre: "Premiers pas",
      description: "Un modèle pour découvrir Quizele en créant votre premier quiz.",
      categorie: "Découverte",
      mode: "libre",
      aleatoire_questions: true,
      aleatoire_options: true,
      correction_immediate: true,
      bonus_rapidite: false,
      visibilite: "lien",
      statut: "brouillon",
    })
    .select()
    .single();

  if (quizError || !quiz) {
    throw new Error(
      quizError?.message ?? "Impossible de créer le quiz"
    );
  }

  const sampleQuestions = [
    {
      ordre: 1,
      type: "unique",
      enonce: "Qui est le premier disciple appelé par Jésus selon l'Évangile de Jean ?",
      duree_sec: 20,
      points: 100,
      explication: "André, frère de Simon Pierre, est le premier à suivre Jésus.",
      options: [
        { libelle: "André", est_correcte: true, ordre: 1 },
        { libelle: "Pierre", est_correcte: false, ordre: 2 },
        { libelle: "Jean", est_correcte: false, ordre: 3 },
        { libelle: "Philippe", est_correcte: false, ordre: 4 },
      ],
    },
    {
      ordre: 2,
      type: "vrai_faux",
      enonce: "La Bible contient 66 livres dans sa version protestante canonique.",
      duree_sec: 15,
      points: 100,
      explication: "L'Ancien Testament compte 39 livres et le Nouveau Testament 27.",
      options: [
        { libelle: "Vrai", est_correcte: true, ordre: 1 },
        { libelle: "Faux", est_correcte: false, ordre: 2 },
      ],
    },
  ];

  for (const sample of sampleQuestions) {
    const { data: question, error: questionError } = await supabase
      .from("questions")
      .insert({
        quiz_id: quiz.id,
        ordre: sample.ordre,
        type: sample.type,
        enonce: sample.enonce,
        duree_sec: sample.duree_sec,
        points: sample.points,
        explication: sample.explication,
      })
      .select()
      .single();

    if (questionError || !question) {
      throw new Error(
        questionError?.message ?? "Impossible de créer la question"
      );
    }

    await supabase.from("options").insert(
      sample.options.map((option) => ({
        question_id: question.id,
        libelle: option.libelle,
        est_correcte: option.est_correcte,
        ordre: option.ordre,
      }))
    );
  }

  revalidatePath("/tableau-de-bord");
  redirect(`/quiz/${quiz.id}`);
  } catch (error) {
    console.error("createSampleQuiz failed:", error);
    throw error instanceof Error ? error : new Error("Impossible de créer le quiz");
  }
}

export async function launchQuiz(quizId: string) {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) {
    throw new Error("Vous devez être connecté");
  }

  const { error: publishError } = await supabase
    .from("quizzes")
    .update({ statut: "publie" })
    .eq("id", quizId)
    .eq("auteur_id", authData.user.id);

  if (publishError) {
    throw new Error(publishError.message);
  }

  const { data, error } = await supabase.rpc("ouvrir_session", {
    p_quiz: quizId,
  });

  if (error || !data || data.length === 0) {
    throw error ?? new Error("Impossible d'ouvrir la session");
  }

  return data[0] as { session_id: string; code_court: string };
}
