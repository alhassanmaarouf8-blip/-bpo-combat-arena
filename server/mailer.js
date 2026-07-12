/**
 * mailer.js — transactional account e-mail (verification + password reset), $0 via Gmail SMTP.
 *
 * Owner order 2026-07-10: "the reset password is done through email" — the WhatsApp-manual flow
 * is dead. Transport: the owner's Gmail with an App Password (free, 500 mails/day, real-Gmail
 * deliverability — no domain, no paid ESP). Configured entirely by env:
 *   SMTP_USER = the Gmail address to send from
 *   SMTP_PASS = a Google "App Password" (Google Account → Security → 2-Step → App passwords)
 *   SMTP_HOST (optional, default smtp.gmail.com) — swap-in seam for any future provider.
 * Until both are set, mailerConfigured() is false and /auth/forgot tells the client honestly.
 */
import nodemailer from 'nodemailer';

export function mailerConfigured() {
  return !!(process.env.BREVO_API_KEY || (process.env.SMTP_USER && process.env.SMTP_PASS));
}

let _tx = null;
function tx() {
  if (!_tx) {
    const port = Number(process.env.SMTP_PORT || 465);
    _tx = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      // Tight timeouts (review catch): nodemailer's defaults (2 min connect, 10 min socket)
      // would let a blackholed SMTP connection pin resources far too long.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  return _tx;
}

async function deliver({ to, subject, text }) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  if (process.env.BREVO_API_KEY) {
    if (!from) throw new Error('SMTP_FROM is required for Brevo delivery');
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'api-key': process.env.BREVO_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: 'OMNI-PERFORM', email: from },
        to: [{ email: to }],
        subject,
        textContent: text,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Brevo delivery failed (${response.status})`);
    return;
  }
  await tx().sendMail({ from: `"OMNI-PERFORM" <${from}>`, to, subject, text });
}

/** Send the password-reset link. Plain, professional, bilingual — no marketing. */
export async function sendResetMail(to, link) {
  const text = [
    'Hallo,',
    '',
    'jemand (hoffentlich du) hat ein neues Passwort für dein OMNI-PERFORM-Konto angefordert.',
    'Der Link ist 45 Minuten gültig und funktioniert genau einmal:',
    '',
    link,
    '',
    'Wenn du das nicht warst, ignoriere diese E-Mail — dein Passwort bleibt unverändert.',
    '',
    'لو انت اللي طلبت تغيير الباسورد، افتح اللينك — صالح ٤٥ دقيقة. لو مش انت، تجاهل الرسالة.',
  ].join('\n');
  await deliver({ to, subject: 'Passwort zurücksetzen · OMNI-PERFORM', text });
}

/** Send the ownership-verification link. Plain, professional, bilingual — no marketing. */
export async function sendVerificationMail(to, link) {
  const text = [
    'Hallo,',
    '',
    'bestätige bitte deine E-Mail-Adresse, bevor du das sprachbasierte OMNI-PERFORM-Training startest:',
    '',
    link,
    '',
    'Der Link ist 24 Stunden gültig und funktioniert genau einmal.',
    'Wenn du kein Konto erstellt hast, kannst du diese E-Mail ignorieren.',
    '',
    'أكد إيميلك قبل ما تبدأ التدريب الصوتي. اللينك صالح ٢٤ ساعة وبيشتغل مرة واحدة.',
  ].join('\n');
  await deliver({ to, subject: 'E-Mail bestätigen · OMNI-PERFORM', text });
}

export default { mailerConfigured, sendResetMail, sendVerificationMail };
