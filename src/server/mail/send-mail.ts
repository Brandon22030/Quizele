import { Resend } from "resend";

// Types optionnels : wrangler types marque ainsi les vars qui diffèrent selon l'environnement.
export interface MailEnv {
  MAIL_TRANSPORT?: string;
  MAIL_FROM?: string;
  RESEND_API_KEY?: string;
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
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
    if (error) throw new Error(`Envoi de l'e-mail refusé par Resend : ${error.message}`);
    return;
  }
  // Transport local : le lien de connexion apparaît dans la console du serveur, aucun e-mail ne part.
  console.info(`[mail:console] à ${mail.to} - ${mail.subject}\n${mail.text}`);
}
