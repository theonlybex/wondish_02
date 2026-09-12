# Beta premium coupons — scenario run, 2026-09-12

Branch `feat/beta-premium-coupons`. Local `next dev` with `PREMIUM_GATES=on`
(inline env, not committed), shared Neon DB. Tester accounts signed in
headlessly through Clerk dev-instance sign-in tokens (`POST /v1/sign_in_tokens`
→ `/login?__clerk_ticket=…`), driven by the Playwright skill. Eight `QA-*`
codes were seeded straight into the `Coupon` table, then removed; the two QA
accounts' `COUPON` rows were deleted and the simulated Stripe row reset.

Tester A = `qa.desktop.20260911@wondish.io`, tester B = `qa.nocond.20260911@wondish.io`.
Both ordinary users (no roles). Numbers refer to the scenario matrix in
`docs/superpowers/plans/2026-09-12-beta-premium-coupons.md`.

## Tester side — 27/27 passed

| # | Scenario | Result |
|---|---|---|
| — | Fresh tester: `/api/me` `isPremium:false`; `/overview` shows the Premium gate | ✅ |
| 1 | Redeem `QA-A30` → 200, `accessUntil` = end of day +30; `/api/me` premium, source COUPON, end matches; gate gone | ✅ |
| 11 | `/membership` shows "Premium · coupon", "Access until …", "Subscribe to keep Premium after …"; `/pricing` reachable (no redirect) | ✅ |
| 5 | Same code again → 409 "You have already redeemed this coupon" | ✅ |
| 1 | Second code `QA-B90` (later) → end moves to +90 | ✅ |
| 2 | Third code `QA-C10` (earlier) → end stays +90, never shortened | ✅ |
| — | Unknown code → 404 "Invalid or unavailable code" | ✅ |
| 7 | Code whose access-until passed → 404 generic | ✅ |
| — | Code whose redeem-by passed → 404 generic | ✅ |
| 17 | Deactivated code → 404 generic | ✅ |
| — | `"  qa-one "` (lower-case, padded) accepted; trim + upper-case work | ✅ |
| 24 | Second account on the 1-use code → 404 generic (cap held) | ✅ |
| — | Header menu → Redeem coupon → `QA-SOON3` → "✓ Premium activated until 9/15/2026" | ✅ |
| — | Banner "Your Premium access ends on Sep 15, 2026 — subscribe to keep it" for the 3-day grant; no banner on the 90-day grant | ✅ |
| 18 | Extend access on `QA-SOON3` to +20 (DB-level, same statement as the route): B lifted to +20, A untouched, 1 row reported | ✅ |
| 3/21 | A's grant set 2 days in the past: `/api/me` `isPremium:false` and reports the STRIPE/FREE row; gate back; `/membership` shows the Free card | ✅ |
| 5 | Expired tester re-entering a used code → 409 | ✅ |
| 8 | B made a live paid subscriber (DB): redeem → 409 "You already have Premium — no code needed." | ✅ |
| 12 | Paid + coupon on one account: `/api/me` reports the STRIPE row | ✅ |
| — | Paid subscriber: `/pricing` → redirect to `/membership` | ✅ |
| 9 | B set to cancel-at-period-end: redeem allowed (200) | ✅ |

## Not exercised here

- **Admin page and admin API** (create code with quantity / redeem-by / access-until, validation copy,
  "Who used it", "Extend access" button). Needs a SUPER session; the run used ordinary QA accounts.
  Checklist for a SUPER user in the browser:
  1. `/admin/coupons` → New Code defaults to Premium, 50 uses, access until +90 days. Create one.
  2. Create with an empty access date → blocked by the form; via API → 400 "Premium codes need an access end date".
  3. Create with redeem-by after access-until → 400 "Redeem-by date must not be after the access end date".
  4. Switch type to Admin → the access-until field disappears.
  5. On a Premium row: "Extend access" → pick a later date → "Extended. N account(s) lifted to the new date."; earlier date → 400.
  6. "Who used it (N)" toggles the redeemer list.
- Rate limit (10/h) — would have locked the QA accounts for an hour.
- Real Stripe checkout from a coupon holder (scenario 11's second half); the checkout route was unchanged and only diverts to the portal when the Stripe row is live.
- iOS.

## Findings

- **Legacy premium codes without an access end.** Three pre-billing-v2 PREMIUM codes still exist
  (`MJC4WBZC` 2/3 used, `QZ32P63F` 1/10, `CLKF8AWF` 1/1). With PREMIUM redemption restored they would
  have granted *lifetime* premium. Fixed in code: the redeem route now treats a PREMIUM code with no
  `accessUntil` as unavailable. Consider deactivating them in `/admin/coupons` as well.
- The 24 h grace on `hasActivePremium` applies to coupon grants (accepted on 2026-09-12).
