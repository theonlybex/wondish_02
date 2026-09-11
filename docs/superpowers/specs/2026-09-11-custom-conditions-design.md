# Custom health conditions — design (2026-09-11)

**Goal.** A user can add a condition Wondish does not list, with its own rules,
and the app treats it like a built-in one: hard ingredient bans in every diet
check, guidance in Clara's prompts, and symptoms in the daily journal.

**Approach (chosen): reuse `HealthCondition`.** A custom condition is a
`HealthCondition` row owned by one patient (`ownerPatientId`), linked through
the existing `PatientHealthCondition`, with its bans in
`HealthConditionBannedIngredient` and its symptoms in `ConditionTrackingItem`.
Everything downstream — `derivePatientBans`, the food map, the symptom step,
journey cards, the calendar — already keys on those tables, so it works with
no new code paths. The alternative (a separate `PatientCustomCondition` model)
would have needed a parallel branch in each of those.

## Data

- `HealthCondition.ownerPatientId String?` (null = global, cascade on patient
  delete) and `HealthCondition.guidance String?` (also usable by admins for
  global rows later; the code map `CONDITION_GUIDANCE` stays as the fallback).
- `name` loses its global `@unique`; replaced by a partial unique index on
  global rows (`WHERE "ownerPatientId" IS NULL`, raw SQL like the trial index)
  and `@@unique([ownerPatientId, name])` for custom rows.
- Custom tracking items: `code = "CUST-<uuid>"`, `itemCode` = upper-snake of
  the label, `category = SYMPTOM`, `inputSource = USER_REPORTED`.
- Migration `20260911180000_custom_conditions`. Additive; applied to the
  shared DB like the earlier ones.

## Rules a user can set (limits in `lib/custom-conditions.ts`)

| Field | Limit | Effect |
|---|---|---|
| Name | 2–60 chars, must not equal a built-in condition (case-insensitive) | Shown in the profile and Clara's "Health conditions" line |
| Ingredients to avoid | up to 40, each 2–60 chars (`normalizeBannedIngredientName`) | Hard bans, source `condition`, everywhere the built-in bans apply (library filter, Clara generation and swap, taste deck, to-buy) |
| Guidance for Clara | up to 300 chars, optional | Food-map line `Condition guidance: "…"`, quoted as user-written |
| Symptoms to track | up to 10 labels, each 2–40 chars | Rows in the journal's symptoms step, day view and trend card |
| Conditions per user | 10 | |

| Triggers to test | up to 8 of the 28 workbook categories | One `TriggerRule` per category (`CUST-TR-<uuid>`, workbook schedule 7/28/3/3, the category's term list as examples, the condition's symptoms monitored); appears on the Trials page like a built-in rule. Kept categories keep their row (a running trial points at it), removed ones are deactivated, new ones created |

Onboarding: the health step has an inline "Don't see yours?" form (name,
ingredients, symptoms) kept in the wizard draft and posted to
`/api/patient/conditions` right after the profile save (409 = already
created on a retry). Note for Clara and triggers are added later in Settings.
Deleting a condition removes its trials first (no cascade from rules).

## API (`app/api/patient/conditions`)

- `GET` — the caller's custom conditions with bans and active symptoms.
- `POST` — create + link to the patient; 422 on validation, 409 on a name
  clash with a built-in or one of the user's own.
- `PATCH /:id` — replace name/bans/guidance; symptoms are synced by label:
  unchanged labels keep their row (and history), removed labels are set
  `active=false` (history kept), new labels get rows.
- `DELETE /:id` — removes the link rows, then the condition (bans, items and
  their journal symptoms cascade).
- Ownership checked on every call; any change flips `mealPlanStale`.
- `PATCH /api/patient/profile` keeps custom links when it rewrites the
  built-in condition list.

## Pickers

Built-in pickers (settings chips, profile route refData, admin parameters)
list only `ownerPatientId: null`. Custom conditions live in their own
"My conditions" section on the profile page (`components/profile/CustomConditions.tsx`):
list with edit/delete, and an add form (name, ingredients tag input, guidance,
symptoms tag input). Onboarding's health step gets a one-line pointer to it.

## Testing

Unit: `lib/custom-conditions.test.ts` (validation, limits, symptom code),
`lib/food-map.test.ts` (DB guidance beats the code map). Live: create a
condition on the variant QA account, confirm the ban reaches the dish check
and the taste deck, the symptom appears in the quick log, Clara's food map
carries the guidance, edit keeps history, delete cleans up.
