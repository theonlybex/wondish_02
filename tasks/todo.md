# Pre-Production TODO

Generated: 2026-05-05 | Build: ✅ Clean (66 routes, 0 TypeScript errors)

---

## 🔴 Critical — Fix Before Deploy

- [ ] **Audit `.env` in git** — run `git ls-files .env`; if tracked, remove from history and rotate all secrets (Stripe, AWS, JWT, email credentials)
- [ ] **Fix broken email resend** — `app/api/auth/verify-email/resend/route.ts:46-47` has a TODO with `console.log` instead of actually sending an email; implement Resend/SendGrid call or disable the resend button
- [ ] **Remove localhost fallbacks from email links** — `lib/email.ts:16,32,56,113` falls back to `http://localhost:3000` if `VERIFICATION_URL` / `RESET_PASSWORD_URL` / `NEXT_PUBLIC_APP_URL` are unset; add env validation on startup instead
- [ ] **Fix hardcoded S3 bucket fallback** — `lib/s3.ts:23` falls back to `"infoatuvera"` if `AWS_S3_BUCKET` is missing; add startup validation

---

## 🟠 Major — Fix Before Traffic

- [ ] **Fix silent meal plan generation failure** — `app/api/patient/profile/route.ts:190-191` swallows meal plan errors with `.catch(console.error)`; surface the error to the user or retry
- [ ] **Add try/catch to 22 unprotected API routes** — raw DB errors currently return 500 with stack traces; wrap each in try/catch and return a safe JSON error:
  - [ ] `app/api/grocery-list/route.ts`
  - [ ] `app/api/journal/route.ts`
  - [ ] `app/api/journal/log-meal/route.ts`
  - [ ] `app/api/meal-plan/alternatives/route.ts`
  - [ ] `app/api/meal-plan/start-date/route.ts`
  - [ ] `app/api/meal-plan/[menuId]/swap/route.ts`
  - [ ] `app/api/orders/route.ts`
  - [ ] `app/api/journey/route.ts`
  - [ ] `app/api/taste/dishes/route.ts`
  - [ ] `app/api/taste/seen/route.ts`
  - [ ] `app/api/taste/set-cookie/route.ts`
  - [ ] `app/api/taste/public-dishes/route.ts`
  - [ ] `app/api/user/complete-onboarding/route.ts`
  - [ ] `app/api/admin/coupons/route.ts`
  - [ ] `app/api/auth/verify-email/resend/route.ts`
  - [ ] remaining routes in `app/api/`

---

## 🟡 Minor — Post-Launch Polish

- [ ] **Remove `console.error` from client code** — `components/CheckoutButton.tsx:27,33`; replace with error tracking (Sentry) or silent failure
- [ ] **Replace `console.error` in API routes** with structured logging or Sentry:
  - `app/api/stripe/checkout/route.ts:38,56`
  - `app/api/stripe/webhook/route.ts:25,152`
  - `app/api/auth/forgot-password/route.ts:31,36`
  - `app/api/upload/route.ts:27`
  - `app/api/patient/profile/route.ts:191,198`

---

## ✅ Verified Passing

- TypeScript build — clean, 0 errors
- Translations (EN / ES / RU) — all 183 keys present
- Auth middleware — all protected routes properly gated
- Stripe webhook — signature verification implemented
- Database queries — Prisma used throughout, no injection risk
- Broken imports — none found
- Placeholder pages — none; all 32 pages have real content
- Admin route guards — `requireAdmin()` on all admin routes
