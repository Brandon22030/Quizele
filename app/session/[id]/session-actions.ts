"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export async function pousserQuestion(
  sessionId: string,
  questionId: string
): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/connexion");
  }

  const { error } = await supabase.rpc("pousser_question", {
    p_session: sessionId,
    p_question: questionId,
  });

  if (error) {
    throw error;
  }

  const { error: reinitError } = await supabase.rpc("reinitialiser_revele", {
    p_session: sessionId,
  });

  if (reinitError) {
    throw reinitError;
  }
}

export async function validerQuestion(sessionId: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/connexion");
  }

  const { error } = await supabase.rpc("valider_question", {
    p_session: sessionId,
  });

  if (error) {
    throw error;
  }
}

export async function terminerSession(sessionId: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/connexion");
  }

  const { error } = await supabase.rpc("terminer_session", {
    p_session: sessionId,
  });

  if (error) {
    throw error;
  }
}

export async function fermerSession(sessionId: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/connexion");
  }

  const { error } = await supabase.rpc("fermer_session", {
    p_session: sessionId,
  });

  if (error) {
    throw error;
  }
}
