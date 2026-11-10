import { Resend } from "resend";

// Types optionnels : wrangler types marque ainsi les vars qui diffèrent selon l'environnement.
export interface MailEnv {
  MAIL_TRANSPORT?: string;
  MAIL_FROM?: string;
  RESEND_API_KEY?: string;
  BETTER_AUTH_URL?: string;
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

// Le transport console écrit le lien de connexion dans les journaux : en ligne (https), il ouvrirait
// n'importe quel compte à qui lit les journaux. Il doit donc être demandé explicitement, et jamais en https.
function assertConsoleAllowed(env: MailEnv): void {
  if (/^\s*https:/i.test(env.BETTER_AUTH_URL ?? "")) {
    throw new Error("Transport console interdit quand BETTER_AUTH_URL est en https.");
  }
}

// Interface unique d'envoi : changer de fournisseur (ou de transport) ne touche que ce fichier.
export async function sendMail(env: MailEnv, mail: Mail): Promise<void> {
  if (env.MAIL_TRANSPORT === "resend") {
    if (!env.RESEND_API_KEY || !env.MAIL_FROM) throw new Error("Transport resend sans RESEND_API_KEY ou MAIL_FROM.");
    const { error } = await new Resend(env.RESEND_API_KEY).emails.send({
      from: env.MAIL_FROM,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    // Le message de Resend peut reprendre l'adresse ou le contenu : seuls le statut et le code sont journalisés.
    if (error) throw new Error(`Envoi de l'e-mail refusé par Resend (statut ${error.statusCode ?? "inconnu"}, code ${error.name}).`);
    return;
  }
  if (env.MAIL_TRANSPORT === "console") {
    assertConsoleAllowed(env);
    console.info(`[mail:console] à ${mail.to} - ${mail.subject}\n${mail.text}`);
    return;
  }
  throw new Error('MAIL_TRANSPORT doit valoir "resend" ou "console".');
}
