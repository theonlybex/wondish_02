// Terms of Service — DRAFT for review, not applied. Dry-run by default.
//   set -a; source .env.local; set +a
//   npx tsx scripts/seed-terms-2026-09-11.ts            # prints the draft
//   npx tsx scripts/seed-terms-2026-09-11.ts --apply    # PUBLISHES it (shared DB → live on /terms)
//
// /terms renders the active TermsAndConditions row (none exists, so the page
// says "will be published soon" while onboarding collects consent to it).
// The text below is a plain-language draft covering the product as built —
// it is NOT legal advice and must be reviewed by counsel before --apply.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");
const VERSION = "2026-09-11-draft";

const CONTENT = `Wondish Terms of Service
Effective: on publication. Version ${VERSION}.

1. Who we are and what Wondish does
Wondish (wondish.io) is a nutrition planning service. It builds weekly meal plans, shopping lists and dish suggestions from the health profile, preferences and pantry you give us, lets you log meals and symptoms, and offers an AI assistant ("Clara") that answers food questions in the context of your profile. Wondish also shows dishes from partner restaurants with an indication of how they fit your profile.

2. Not medical advice
Wondish is a planning tool, not a medical service. Nothing in the app — meal plans, ingredient exclusions, condition guidance, trigger trials, Clara's answers, restaurant verdicts — is medical advice, diagnosis or treatment. Rules you add yourself (your own conditions, ingredients to avoid, symptoms, triggers) are applied as you entered them. Always check dietary changes with your clinician, especially if you are pregnant, under medical care or managing a diagnosed condition. If you have an allergy, treat every dish and restaurant listing as unverified: ingredient data can be incomplete or wrong, and you remain responsible for checking what you eat.

3. Eligibility and your account
You must be at least 13 years old to use Wondish. You are responsible for the accuracy of the profile you enter, for keeping your sign-in credentials private, and for everything done through your account. Sign-in is provided by our authentication partner; deleting your account in Settings removes your profile, plans, journal and other personal data from Wondish.

4. Your content
You keep ownership of what you enter — profile details, journal entries, symptoms, your own conditions and rules, photos or notes. You give Wondish permission to store and process that content to run the service for you, including sending the parts needed to our AI provider so Clara can answer. We do not sell your personal data. Our Privacy Policy explains what we collect and how it is used.

5. Subscriptions and payment
Some features are offered under a paid plan. Prices, billing periods and what each plan includes are shown at checkout. Payments are processed by Stripe; Wondish does not store your card details. Subscriptions renew automatically until cancelled. You can cancel at any time from the Membership page; the plan stays active until the end of the paid period, after which no further charges are made. Promotional codes apply as described when you redeem them. Except where the law requires otherwise, payments are non-refundable.

6. Acceptable use
Do not use Wondish to break the law, to harm others, to probe or disrupt the service, to scrape or resell its content, or to enter content you have no right to share. Do not try to make Clara act outside its purpose. We may suspend or close accounts that breach these terms.

7. Restaurant listings
Restaurant menus, ingredients and prices are provided by the restaurants or compiled from public information and may be out of date or incomplete. A "fits your profile" indication is computed from the listed ingredients only. Confirm allergens and ingredients with the restaurant before ordering. Restaurants that manage their listings on Wondish are responsible for their accuracy.

8. Availability and changes
We work to keep Wondish available but do not guarantee uninterrupted service. We may change, add or remove features, and we may update these terms; when a change is material we will tell you in the app or by email. Continued use after a change means you accept it.

9. Intellectual property
The Wondish name, design, software, recipe catalogue and generated plans belong to Wondish or its licensors. You may use them for your personal, non-commercial use only.

10. Disclaimer and limitation of liability
Wondish is provided "as is". To the fullest extent permitted by law we exclude all warranties, and we are not liable for indirect, incidental or consequential loss, or for any health outcome, arising from your use of the service. Where liability cannot be excluded, it is limited to the amount you paid Wondish in the twelve months before the claim.

11. Governing law
These terms are governed by the laws of the State of California, USA, and disputes will be brought in its courts, unless the law of your country gives you rights that cannot be waived.

12. Contact
Questions about these terms: support@wondish.io. Privacy requests: privacy@wondish.io.`;

(async () => {
  const existing = await prisma.termsAndConditions.findUnique({ where: { version: VERSION }, select: { id: true, isActive: true } });
  const active = await prisma.termsAndConditions.findFirst({ where: { isActive: true }, select: { version: true } });
  console.log(`active terms now: ${active?.version ?? "(none)"}; draft ${VERSION} exists: ${existing ? "yes" : "no"}`);
  if (!apply) {
    console.log(`\n--- DRAFT (${CONTENT.length} chars) ---\n${CONTENT}\n--- end ---\nDry run: nothing written. Review with counsel, edit CONTENT, then --apply to publish.`);
    await prisma.$disconnect();
    return;
  }
  await prisma.$transaction([
    prisma.termsAndConditions.updateMany({ where: { isActive: true }, data: { isActive: false } }),
    existing
      ? prisma.termsAndConditions.update({ where: { id: existing.id }, data: { content: CONTENT, isActive: true } })
      : prisma.termsAndConditions.create({ data: { version: VERSION, content: CONTENT, isActive: true } }),
  ]);
  console.log(`Published ${VERSION} as the active terms.`);
  await prisma.$disconnect();
})();
