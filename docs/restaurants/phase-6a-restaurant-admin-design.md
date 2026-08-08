# Phase 6a — Restaurant Admin: self-service menu management (design)

*Drafted 2026-08-04 from the user directive: "a new role: Restaurant Admin …
access on the website to change the dishes of their own restaurant … input
information about the dish that we need for our system, such as calories,
choose raw ingredients from the selection of our website ingredients … recipe
is not required if they don't want to share."*

This is the **menu-management core of Phase 6** (docs/restaurants/phase-6.md),
carved out so it can ship before the monetization pieces (paid placement,
recommended-dish discount). Everything here composes with the existing
Phase-1 admin system rather than replacing it: Wondish ops keeps the
`/admin/restaurants` surface and the `SUPER` role; restaurants get a scoped
portal of their own.

---

## 0. One decision up front: rows, not per-restaurant tables

The ask was "each restaurant probably would need its own table of dishes in
the database." Each restaurant **already has its own menu** — as its own
*slice of rows* in the shared `RestaurantDish` table, keyed by
`restaurantId` (`prisma/schema.prisma:454`). That is the standard relational
design and we should keep it:

- **Isolation is enforced by authorization, not by table layout** — the new
  `requireRestaurantStaff(restaurantId)` helper (§3) makes it impossible for
  one restaurant's account to read or write another restaurant's rows, which
  is exactly the guarantee a physical per-restaurant table would give.
- Physical per-restaurant tables would break Prisma migrations (schema is
  static), make cross-restaurant queries (search, ranking, admin lists,
  analytics) painful, and add operational cost for zero extra safety.

So: **one `RestaurantDish` table, row-scoped per restaurant** — logically
"each restaurant's own table," physically one table.

## 1. Principles

1. **D-INGREDIENTS stays law** (docs/restaurants/overview.md): allergy/diet
   verdicts are computed only from human-owned structured ingredient lists.
   Restaurant staff entering their own ingredients *strengthens* this — the
   list is finally owned by the people who cook the dish, not inferred.
2. **Recipes are never required.** The dish model has no preparation steps
   and this design adds none. What Wondish needs per dish: name, section,
   the ingredient list (for verdicts), and ideally whole-dish macros (for
   calorie budgeting in meal-log / plan-exchange). Quantities per ingredient
   stay optional; descriptions optional; how the dish is made stays the
   restaurant's secret.
3. **Low-trust actors get guardrails, not friction walls.** Everyday edits
   (price, availability, nutrition, description) apply instantly; the
   safety-critical surface (ingredient lists on published dishes, first
   publish) goes through a lightweight ops review (§7).
4. **Reuse the Phase-1 machinery**: dish/ingredient validation
   (`lib/admin-restaurants.ts`), the publish gate, the admin form components,
   the design system.

## 2. Schema changes (one migration)

```prisma
enum RestaurantStaffRole {
  OWNER      // full control incl. inviting/removing staff
  MANAGER    // menu + profile edits; cannot manage staff
}

model RestaurantStaff {
  id           String              @id @default(cuid())
  accountId    String
  account      Account             @relation(fields: [accountId], references: [id], onDelete: Cascade)
  restaurantId String
  restaurant   Restaurant          @relation(fields: [restaurantId], references: [id], onDelete: Cascade)
  role         RestaurantStaffRole @default(MANAGER)
  createdAt    DateTime            @default(now())
  invitedById  String?             // Account.id of the inviter (admin or OWNER)

  @@unique([accountId, restaurantId])
  @@index([restaurantId])
}

model RestaurantInvite {
  id                String              @id @default(cuid())
  restaurantId      String
  restaurant        Restaurant          @relation(fields: [restaurantId], references: [id], onDelete: Cascade)
  email             String
  role              RestaurantStaffRole @default(OWNER)
  clerkInvitationId String?             // if sent through Clerk Invitations
  status            String              @default("PENDING") // PENDING | ACCEPTED | REVOKED | EXPIRED
  invitedById       String
  createdAt         DateTime            @default(now())
  acceptedAt        DateTime?

  @@index([restaurantId, status])
  @@index([email])
}

model RestaurantAuditLog {
  id           String   @id @default(cuid())
  restaurantId String
  accountId    String   // who did it (staff or SUPER)
  entity       String   // "restaurant" | "dish" | "ingredients" | "staff" | "invite"
  entityId     String?
  action       String   // "create" | "update" | "publish" | "unpublish" | "delete" | ...
  diff         Json?    // { field: { from, to } } for updates
  createdAt    DateTime @default(now())

  @@index([restaurantId, createdAt])
}
```

Additions to existing models:

```prisma
model RestaurantDish {
  // ...
  status         RestaurantDishStatus // gains PENDING_REVIEW (enum addition)
  lastVerifiedAt DateTime?            // set on staff publish/verify; drives freshness
  deletedAt      DateTime?            // soft delete replaces hard delete for staff
}

model RestaurantDishIngredient {
  // ...
  ingredientId String?     // NEW nullable FK → Ingredient (site catalog)
  ingredient   Ingredient? @relation(...)
  // `name` stays the denormalized display string and remains the verdict
  // input, so nothing downstream changes shape.
}

model IngredientRequest {           // staff asked for an ingredient we don't have
  id           String   @id @default(cuid())
  name         String
  restaurantId String
  requestedBy  String   // Account.id
  status       String   @default("PENDING") // PENDING | MAPPED | REJECTED
  mappedToId   String?  // Ingredient.id once ops resolves it
  createdAt    DateTime @default(now())
}
```

New `Role` row: **`RESTAURANT_ADMIN`** (assigned via `AccountRole` on invite
acceptance; an account can hold it for several restaurants via multiple
`RestaurantStaff` rows — the role gates the portal, `RestaurantStaff` gates
*which* restaurant).

## 3. Authorization

New helper in `lib/restaurant-auth.ts`, mirroring `requireAdmin()`'s shape:

```ts
requireRestaurantStaff(restaurantId, minRole: "MANAGER" | "OWNER" = "MANAGER")
// → { account, staff } | throws UNAUTHORIZED / FORBIDDEN
// SUPER bypasses (ops can always act on any restaurant).
```

Every portal API route takes `restaurantId` from the URL path (never the
body) and passes it through this helper. List endpoints ("my restaurants")
derive from `RestaurantStaff.accountId` only. There is no way to name a
restaurant you aren't staff of.

## 4. Onboarding & invites (invite-only for now)

Open self-signup needs ownership verification we don't have an answer for
(phase-6.md open question 3), so v1 is **invite-gated**, two tiers:

**A. Wondish ops invites the restaurant (the trust root).**
1. Admin opens `/admin/restaurants/[id]` → new "Staff" tab → "Invite owner",
   enters email, picks role OWNER.
2. Server creates `RestaurantInvite` and sends a **Clerk Invitation**
   (Clerk's Invitations API sends the email itself — no new email provider)
   with `public_metadata: { restaurantInviteId }`. If the email already has
   an account, we skip Clerk and the invite shows up in-app (§4C).
3. Invitee clicks the email link → Clerk sign-up (their normal flow) → lands
   on `/restaurant/accept?inviteId=…`.
4. Accept endpoint validates: invite PENDING, signed-in email matches invite
   email (case-insensitive), not expired (30 days). On success, in one
   transaction: create `RestaurantStaff`, grant `RESTAURANT_ADMIN` role,
   mark invite ACCEPTED, write audit row. Redirect to the portal.

**B. Owners add their own staff — email-free (amended 2026-08-08).** From
the portal's Staff screen, an owner adds a manager by typing the teammate's
Wondish account email: direct assignment via the same mechanics as §4D
(`POST /api/restaurant-portal/[id]/staff`, `allowInviteFallback: false`).
No invites and no emails originate from the portal — if the email has no
Wondish account yet, the owner gets "ask them to sign up first, then add
them here." Restricted to `role: MANAGER`, capped at 10 seats per
restaurant (active staff + any ops-created pending invites), removable.
OWNER role can only be granted by Wondish ops. *(Supersedes the original
owner-invite email flow; only ops originates invites now.)*

**C. Edge cases, decided now:**
- Email already registered → invite is claimable in-app: a banner on
  `/overview` ("You've been invited to manage La Palma — Accept") driven by
  a pending-invites lookup on the signed-in email.
- Wrong email signed in at accept → clear error naming the invited address,
  never auto-attach.
- Revocation: admin or OWNER can revoke a PENDING invite; removing a staff
  row also removes `RESTAURANT_ADMIN` if it was their last restaurant.
- An account can be staff of multiple restaurants (chains): portal shows a
  restaurant switcher (§5.1).

**D. Direct assignment by ops (shipped with the M3/M4 fix wave follow-up).**
For internal testing and hand-onboarding, admin can attach an *existing*
account to a restaurant without the invite→accept round-trip:

- `POST /api/admin/restaurants/[id]/staff` with `{ email, role }`,
  `requireAdmin()`-gated (admin is already the trust root and may grant
  OWNER). Looks up the account by email; when none exists it falls back to
  `createStaffInvite` so the admin form is one action either way — the
  response's `mode` (`assigned` / `promoted` / `invited`) says which path
  happened. On assign, one transaction mirroring the accept-invite path in
  `lib/restaurant-invites-server.ts`: create `RestaurantStaff`
  (`invitedById` = the acting admin), upsert the global `RESTAURANT_ADMIN`
  role, supersede PENDING `RestaurantInvite`s for the same email+restaurant
  **at or below the assigned tier** (marked REVOKED — nobody accepted
  anything; a higher-tier pending invite stays claimable and just promotes
  later), and write the audit row (`entity: "staff"`, `action: "assign"`,
  superseded invite ids in the diff). Live Clerk email links of superseded
  invites are best-effort revoked after the transaction. Tier rules mirror
  accept-invite: a MANAGER is promoted by an OWNER assignment, never
  demoted; already at (or above) the requested tier → 409. Account lookup
  is case-insensitive (Clerk stores emails verbatim). Decision rules are
  pure (`planDirectAssign`, `supersedableInviteRoles` in
  `lib/restaurant-invites.ts`, unit-tested).
- Admin UI: the Staff tab's "Invite" form generalizes to **"Add staff"** —
  one email field + role select; the server direct-assigns when the account
  exists and falls back to creating an invite when it doesn't, and the
  response says which path happened ("Added directly — they can open the
  portal now" vs "Invite created").
- Scoping is inherent, nothing new to build: membership is the
  `RestaurantStaff (accountId, restaurantId)` row, so an assignment grants
  exactly one restaurant (e.g. "Dumpling U admin"); the global role only
  unlocks the portal shell, and every portal page/API re-checks the staff
  row. Removal already exists (§4C) and drops the global role with the
  last restaurant.

## 5. The portal — `app/(restaurant)/…`

Desktop-first (menu management is a laptop job), same design system as the
dashboard. Route group with its own layout: left nav (Menu, Profile, Staff,
Activity), restaurant switcher in the header, no consumer-dashboard chrome.
*(Per repo rule, invoke `ui-ux-pro-max` before building any of these
screens.)*

### 5.1 Entry & dashboard — `/restaurant`
- Zero restaurants → friendly "ask your Wondish contact for an invite" page.
- One restaurant → straight to its dashboard. Multiple → switcher.
- **Back affordance (amended 2026-08-08).** Because of that redirect,
  `/restaurant` is not a safe universal "back" target: for the common
  single-membership account it bounces straight back into the restaurant,
  so a "← Your restaurants" link is a dead control that silently stacks
  browser-history entries. The scoped layout now asks `portalBackLink`
  (pure, unit-tested in `lib/restaurant-portal-nav.ts`) for a destination
  that actually renders: switcher at 2+ memberships, `/admin/restaurants`
  for ops, `/overview` for staff who are also onboarded patients, and no
  link at all for portal-only staff — the portal is their home. It must
  never offer `/overview` to a non-onboarded staff account, which the
  dashboard onboarding gate would bounce back here (§5).
- Dashboard cards: publish state ("14 of 16 dishes live"), **nutrition
  coverage** ("3 dishes missing calories"), **freshness** ("menu last
  verified 2026-05-02 — verify now"), pending review items, recent activity.

### 5.2 Menu manager — `/restaurant/[id]/menu`
Reuses the generalized Phase-1 `RestaurantDishManager` (extract the
data-fetch out of the admin component; render is identical):
- Dishes grouped by section, ordered by `sortOrder`; drag-to-reorder within
  a section writes `sortOrder` (instant).
- Row: name, price, kcal (or "no nutrition" chip), ingredient count, status
  chip (Draft / In review / Live), **Available toggle** — the "86 it"
  switch, instant, for when the kitchen runs out.
- Actions: Edit, Duplicate (fastest way to enter similar dishes),
  Remove (soft delete with confirm; hidden from app immediately, restorable
  by ops, `MealLog` provenance preserved).
- "Add dish" → dish editor.

### 5.3 Dish editor (the core screen)
One form, same validation module as admin (`lib/admin-restaurants.ts`):

| Group | Fields | Rules |
|---|---|---|
| Basics | name*, section* (typeahead over the restaurant's existing sections), description | name+section unique per restaurant (reconcile key) |
| Price | price, currency | Phase-1 `coercePrice` |
| **Nutrition** | calories, protein, carbs, fat, fiber — **whole dish as served** | all optional; each blank stays null (never 0); helper text: "estimates are fine — diners use this to budget their day"; a live "Nutrition complete ✓ / incomplete" chip mirrors the app's `incomplete` logic |
| **Ingredients** | repeater of rows, each picked from the **site ingredient catalog** (§6) | ≥1 row required to publish (Phase-1 gate, unchanged); quantity/unit optional per row |
| Flags | available | `isRecommended` stays **ops-only** in v1 (it feeds ranking; becomes self-serve with the Phase-6 discount work) |

- **No recipe field exists, deliberately.** Copy on the ingredients header:
  "List what's in the dish — you never need to share how you make it.
  Ingredients power allergy safety; amounts are optional."
- Save = Draft. **Publish** runs the gate and then the review rules (§7).
- On publish, a required confirmation checkbox: *"I confirm this ingredient
  list is complete and accurate to the best of my knowledge, including for
  allergy purposes."* — stored in the audit log with account + timestamp.
  This is the human-verification step the seed-data caveats have been
  waiting for.

### 5.4 Ingredient picker interaction (detail)
- Type-ahead searching `Ingredient` (name `contains`, case-insensitive,
  ranked exact-prefix first) + allergen synonyms so "groundnut" finds
  "Peanut". Debounced 200 ms; keyboard navigable.
- Selecting stores `{ ingredientId, name: ingredient.name }`.
- **No match** → "Add '<query>' as a new ingredient" row → creates the dish
  row as free text (`ingredientId: null`) *and* an `IngredientRequest`.
  Free-text rows show a small "pending catalog match" chip. They still
  count for the publish gate and still drive verdicts by name (exactly like
  today's data) — ops later maps them to a catalog entry from a new
  `/admin/ingredient-requests` queue, which backfills `ingredientId`.
- Why the catalog matters: canonical ids make verdict matching stop
  depending on string luck, dedupe spelling variants, and later let one
  ingredient correction propagate everywhere.

### 5.5 Restaurant profile — `/restaurant/[id]/profile`
Name (display only in v1 — renames go through ops), description,
neighborhood, address, phone, website, hours, **real image upload** for
photo + logo (extend `/api/upload` folder allowlist with `restaurants`;
staff-scoped; replaces the current paste-a-URL inputs for this surface).
Restaurant `status` (archive) stays ops-only.

### 5.6 Preview as a diner — `/restaurant/[id]/preview`
Server-renders the same DTO the iOS app consumes (`serializeRestaurantDetail`
+ `serializeDish`) with `matchers: null`, so staff see exactly what a diner
without a profile sees — sections, prices, kcal, "Wondish pick". Fixes
today's gap where a restaurant literally cannot see its own live menu.

### 5.7 Staff & activity
- Staff list (OWNER only): members, roles, invites with status, revoke.
- Activity — `RestaurantAuditLog` newest-first, human-readable ("Maria
  updated Pad Thai: price 17.99 → 18.99").

## 6. API surface (all new, namespaced away from `/api/admin`)

| Route | Method(s) | Auth | Notes |
|---|---|---|---|
| `/api/restaurant-portal/mine` | GET | RESTAURANT_ADMIN | restaurants I'm staff of |
| `/api/restaurant-portal/[id]` | GET, PATCH | staff(MANAGER) | PATCH allowlist: profile fields only (no status/slug/isRecommended) |
| `/api/restaurant-portal/[id]/dishes` | GET, POST | staff(MANAGER) | POST uses a **`DISH_MUTABLE_FIELDS` allowlist** (closes the `...rest` spread the admin route tolerates) |
| `/api/restaurant-portal/[id]/dishes/[dishId]` | PATCH, DELETE | staff(MANAGER) | DELETE = soft delete; PATCH runs review rules |
| `/api/restaurant-portal/[id]/staff` | GET, DELETE | staff(OWNER) | |
| `/api/restaurant-portal/[id]/invites` | GET, POST, DELETE | staff(OWNER) | POST restricted to MANAGER role |
| `/api/restaurant-portal/accept-invite` | POST | signed-in | §4 validations |
| `/api/ingredients/search?q=` | GET | RESTAURANT_ADMIN or SUPER | catalog typeahead |
| `/api/restaurant-portal/[id]/activity` | GET | staff(MANAGER) | paginated audit log |
| Admin additions | | SUPER | Staff tab endpoints, `/api/admin/ingredient-requests` (list/map/reject), review queue (§7) |

Cross-cutting: every write is rate-limited (reuse `rateLimit`, e.g. 60/60s
per account), audited, and validated through the Phase-1 module. Server
re-checks `restaurantId` ownership on the *dish* row too (`dish.restaurantId
=== params.id`), mirroring the admin routes' 404 posture.

## 7. Review workflow (trust, v1 rules)

Dish `status` gains `PENDING_REVIEW`. The rules balance safety against
"my menu is my business":

| Staff action | Effect |
|---|---|
| Edit price, availability, description, sortOrder, **nutrition** | **Instant** — display data, no verdict impact |
| Create dish + publish (first publish) | → `PENDING_REVIEW`; ops approves → `PUBLISHED` |
| Edit **ingredients** or **name** of a `PUBLISHED` dish | Dish stays live with its *previous* ingredient list; changes go to `PENDING_REVIEW`; on approval they swap in (verdict-affecting data never changes without a second pair of eyes) |
| Unpublish / mark unavailable | Instant (removing from sale is always safe) |

Ops side: `/admin/review-queue` — diff view (old vs new ingredient list),
approve / reject-with-note; decisions notify the restaurant (in-portal
banner; email later). SUPER edits skip review (unchanged behavior).
Publishing also stamps `lastVerifiedAt`; a quarterly "verify your menu"
nudge (portal banner first, email when we have a provider) keeps
`coherence.md`'s freshness requirement honest, and the iOS app can later
show a "verified <month>" line per restaurant.

## 8. What the iOS app needs to change

**Nothing, to launch.** The portal feeds the same `Restaurant*` tables the
existing consumer endpoints already serve. Later, additive: freshness/
"verified" display, and dish images if we add them.

## 9. Rollout

1. **M1 — foundations:** migration (§2), `RESTAURANT_ADMIN` role,
   `requireRestaurantStaff`, invites + accept flow, admin Staff tab.
   *(Testable end-to-end with curl before any portal UI.)*
2. **M2 — portal MVP:** layout + dashboard + menu manager + dish editor
   with catalog picker & nutrition; instant-edit rules; audit log.
3. **M3 — review workflow:** PENDING_REVIEW states, admin queue,
   ingredient-request mapping queue.
4. **M4 — polish:** profile + uploads, preview-as-diner, staff management
   UI, freshness nudges, activity screen.
5. **M5 — ops direct staff assignment (§4D):** admin attaches an existing
   account as OWNER/MANAGER of a single restaurant, no invite round-trip.
   Unblocks internal workflow testing (e.g. make a test account the
   Dumpling U admin) before real invites go out.
6. **Pilot:** invite the 5 Stockton restaurants; their first job is
   confirming the AI-inferred ingredient lists and AI-estimated nutrition —
   which retires the two standing provenance caveats in
   `scripts/seed-restaurants.ts`.

Deferred to full Phase 6: paid placement, recommended-dish + discount, B2B
billing, open signup, analytics/attribution dashboards.

## 10. Open decisions (product)

1. Review strictness v1: the split above, or review *every* publish?
2. Staff cap & whether MANAGERs may edit the restaurant profile (assumed yes).
3. Nutrition entry: also offer per-100g/per-serving entry with client-side
   conversion, or whole-dish only (assumed whole-dish only, matching schema)?
4. When email is needed beyond Clerk invitations (review decisions,
   freshness nudges) — pick a provider then, not now.
