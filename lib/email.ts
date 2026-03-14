import nodemailer from "nodemailer";

function getTransport() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
}

const FROM = process.env.EMAIL_FROM ?? "Wondish <no-reply@wondish.io>";

export async function sendVerificationEmail(to: string, token: string) {
  const url = `${process.env.VERIFICATION_URL ?? "http://localhost:3000/verify-email?token="}${token}`;
  await getTransport().sendMail({
    from: FROM,
    to,
    subject: "Verify your Wondish account",
    html: emailTemplate({
      title: "Verify your email",
      body: "Thanks for signing up for Wondish! Click the button below to verify your email address.",
      ctaText: "Verify email",
      ctaUrl: url,
      footer: "If you didn't create a Wondish account, you can safely ignore this email.",
    }),
  });
}

export async function sendPasswordResetEmail(to: string, token: string) {
  const url = `${process.env.RESET_PASSWORD_URL ?? "http://localhost:3000/reset-password?token="}${token}`;
  await getTransport().sendMail({
    from: FROM,
    to,
    subject: "Reset your Wondish password",
    html: emailTemplate({
      title: "Reset your password",
      body: "We received a request to reset the password for your Wondish account. Click the button below to choose a new password.",
      ctaText: "Reset password",
      ctaUrl: url,
      footer: "If you didn't request a password reset, you can safely ignore this email. This link expires in 1 hour.",
    }),
  });
}

export async function sendWelcomeEmail(to: string, firstName: string) {
  await getTransport().sendMail({
    from: FROM,
    to,
    subject: "Welcome to Wondish! 🎉",
    html: emailTemplate({
      title: `Welcome, ${firstName}!`,
      body: "Congratulations — you've successfully joined Wondish. You're now ready to start your personalized nutrition journey.",
      ctaText: "Get started",
      ctaUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/dashboard`,
      footer: "Thank you for joining Wondish.",
    }),
  });
}

// ── HTML template ─────────────────────────────────────────────────────────────

interface TemplateOptions {
  title: string;
  body: string;
  ctaText: string;
  ctaUrl: string;
  footer: string;
}

function emailTemplate({ title, body, ctaText, ctaUrl, footer }: TemplateOptions) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#F8F7FA;font-family:'Public Sans',system-ui,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F8F7FA;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
          <!-- Logo -->
          <tr>
            <td style="padding-bottom:24px;text-align:center;">
              <div style="display:inline-flex;align-items:center;gap:8px;">
                <div style="background:#7367F0;border-radius:8px;width:32px;height:32px;display:inline-block;text-align:center;line-height:32px;">
                  <span style="color:white;font-weight:700;font-size:14px;">W</span>
                </div>
                <span style="color:#25293C;font-weight:600;font-size:18px;">Wondish</span>
              </div>
            </td>
          </tr>
          <!-- Card -->
          <tr>
            <td style="background:#FFFFFF;border-radius:16px;padding:40px;border:1px solid #E8E7EA;">
              <h1 style="color:#25293C;font-size:22px;font-weight:700;margin:0 0 16px;">${title}</h1>
              <p style="color:#8A8D93;font-size:15px;line-height:1.6;margin:0 0 28px;">${body}</p>
              <a href="${ctaUrl}"
                style="display:inline-block;background:#7367F0;color:#FFFFFF;text-decoration:none;font-weight:600;font-size:14px;padding:14px 28px;border-radius:10px;">
                ${ctaText}
              </a>
              <p style="color:#BDBDBD;font-size:12px;margin:24px 0 0;">${footer}</p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding-top:24px;text-align:center;">
              <p style="color:#BDBDBD;font-size:12px;margin:0;">
                © ${new Date().getFullYear()} Wondish · <a href="${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}" style="color:#BDBDBD;">wondish.io</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
