import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "@/lib/db";
import { createStripeCustomer, createCheckoutSession } from "@/lib/stripe";
import { sendVerificationEmail, sendWelcomeEmail } from "@/lib/email";

const LOOKUP_KEY = process.env.STRIPE_PRICE_LOOKUP_KEY ?? "premium_monthly";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { firstName, lastName, email, password, plan, agreedTerms } = body;

    if (!firstName || !lastName || !email || !password) {
      return NextResponse.json({ error: "All fields are required." }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
    }
    if (!agreedTerms) {
      return NextResponse.json({ error: "You must accept the terms and conditions." }, { status: 400 });
    }

    const existing = await prisma.account.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const account = await prisma.account.create({
      data: {
        firstName,
        lastName,
        email,
        password: hashedPassword,
        agreedTerms: true,
        subscription: { create: { plan: "FREE", status: "ACTIVE" } },
      },
    });

    // Store verification token (expires in 24h)
    const verificationToken = crypto.randomBytes(32).toString("hex");
    await prisma.verificationToken.create({
      data: {
        token: verificationToken,
        email,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    // Non-blocking emails
    Promise.all([
      sendVerificationEmail(email, verificationToken),
      sendWelcomeEmail(email, firstName),
    ]).catch((err) => console.error("[register] email error:", err));

    // Premium → Stripe checkout with 14-day trial
    if (plan === "premium") {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
      const customer = await createStripeCustomer(email, `${firstName} ${lastName}`);

      await prisma.subscription.update({
        where: { accountId: account.id },
        data: { stripeCustomerId: customer.id, plan: "PREMIUM", status: "TRIALING" },
      });

      const session = await createCheckoutSession({
        customerId: customer.id,
        lookupKey: LOOKUP_KEY,
        successUrl: `${appUrl}/dashboard`,
        cancelUrl: `${appUrl}/pricing`,
        accountId: account.id,
      });

      return NextResponse.json({ checkoutUrl: session.url }, { status: 201 });
    }

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (err) {
    console.error("[register]", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "An unexpected error occurred.", detail: message }, { status: 500 });
  }
}
