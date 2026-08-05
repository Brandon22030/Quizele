"use server";

import { createClient } from "@/lib/supabase/server";

function mapError(message: string): string {
  if (message.includes("session introuvable") || message.includes("pas trouvé")) {
    return "Ce code ne correspond à aucune session ouverte.";
  }
  if (message.includes("session fermée") || message.includes("terminée")) {
    return "Cette session est terminée.";
  }
  if (message.includes("pseudo déjà pris")) {
    return "Ce pseudo est déjà utilisé dans cette partie.";
  }
  return message;
}

export async function joinSession(
  code: string,
  pseudo: string
): Promise<{ participant_id: string; reprise: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Connexion anonyme requise. Recharge la page.");
  }

  const { data, error } = await supabase.rpc("rejoindre_session", {
    p_code: code,
    p_pseudo: pseudo,
  });

  if (error) {
    throw new Error(mapError(error.message));
  }

  const row = data as Record<string, unknown> | null;
  if (!row) {
    throw new Error("Réponse inattendue du serveur.");
  }

  return {
    participant_id: row.participant_id as string,
    reprise: (row.reprise as boolean) ?? false,
  };
}
