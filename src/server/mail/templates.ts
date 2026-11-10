import type { Mail } from "./send-mail";

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function magicLinkMail(to: string, url: string, expiresInMinutes: number): Mail {
  const text = [
    "Bonjour,",
    "",
    "Voici votre lien de connexion à Quizdeszeles :",
    url,
    "",
    `Il est valable ${expiresInMinutes} minutes et ne sert qu'une seule fois.`,
    "Si vous n'avez pas demandé ce lien, vous pouvez ignorer ce message.",
  ].join("\n");
  const safeUrl = escapeHtml(url);
  const html = [
    "<p>Bonjour,</p>",
    `<p>Voici votre lien de connexion à Quizdeszeles : <a href="${safeUrl}">me connecter</a></p>`,
    `<p>Il est valable ${expiresInMinutes} minutes et ne sert qu'une seule fois.</p>`,
    "<p>Si vous n'avez pas demandé ce lien, vous pouvez ignorer ce message.</p>",
  ].join("");
  return { to, subject: "Votre lien de connexion à Quizdeszeles", text, html };
}
