# Weight Loss Prediction — Landing Page Feature

**Date:** 2026-05-22  
**Status:** Approved  
**Scope:** `components/PredictionTeaser.tsx` (and a new sub-component)

---

## Overview

Transform the static demo card in the "See Your Future" landing section into a live, interactive 7-question weight-loss prediction quiz. Users answer one question at a time, pressing Enter to advance. After the final answer the quiz card swaps to a result view showing their predicted days, stats, a white tagline, and a green "Get Healthy" CTA.

The left-hand copy block is unchanged throughout.

---

## User Flow

```
Landing page loads
  → Right card shows: quiz, Question 1 of 7
  → User answers → presses Enter → slide animation → next question
  → (repeat through Q7)
  → Right card swaps to: result view
       - animated days count
       - stats row (current / goal / pace)
       - white text: "It's easier to get to your ideal form with our formulas"
       - green "Get Healthy" button → /register
```

---

## The 7 Questions

| # | Question | Input type | Unit toggle |
|---|----------|-----------|------------|
| 1 | What's your biological sex? | Chip select (Male / Female) | — |
| 2 | How old are you? | Number input | — |
| 3 | How tall are you? | Two number inputs (ft + in) **or** one cm input | ft/in (default) / cm toggle |
| 4 | What's your current weight? | Number input | lbs (default) / kg |
| 5 | What's your goal weight? | Number input | lbs / kg (follows Q4 selection) |
| 6 | How active are you? | Chip select (4 options) | — |
| 7 | Weekly weight loss pace? | Number input, pre-filled via TDEE suggestion | lbs / kg |

**Activity level chips (Q6):**
- Sedentary (desk job, little exercise) → multiplier 1.2
- Lightly active (1–3 days/week) → 1.375
- Moderately active (3–5 days/week) → 1.55
- Very active (6–7 days/week) → 1.725

---

## Calculation

### Step 1 — TDEE suggestion (used only to pre-fill Q7)

```
BMR (Mifflin-St Jeor):
  Male:   10 × weight_kg + 6.25 × height_cm − 5 × age + 5
  Female: 10 × weight_kg + 6.25 × height_cm − 5 × age − 161

TDEE = BMR × activity_multiplier

daily_deficit = min(TDEE × 0.20, 1000)   // 20% deficit, hard cap 1000 cal/day
weekly_loss_lbs = daily_deficit × 7 / 3500
suggested_weekly_lbs = clamp(round(weekly_loss_lbs, 1), 0.5, 2.0)
```

This suggestion is shown as the pre-filled value in Q7. The user can edit it before pressing Enter.

### Step 2 — Prediction (the product formula)

```
weightToLose = currentWeight − goalWeight   (in lbs)
days = round((weightToLose / weeklyPace) × 7)
```

All inputs normalised to lbs internally before calculation. Display unit follows the user's lbs/kg toggle selection.

---

## Component Architecture

### Modified: `components/PredictionTeaser.tsx`

- Remove `SpinCount` and static card markup from the right column.
- Import and render the new `<PredictionQuiz />` component in the right column.
- No other changes.

### New: `components/PredictionQuiz.tsx`

Self-contained client component. Internal state machine:

```
state: { step: 0..6, answers: Partial<Answers>, unit: 'lbs'|'kg', result: PredictionResult | null }
```

**Phases:**
- `step 0–6` → quiz phase, renders one question at a time
- `result !== null` → result phase, renders result card

**Question rendering:**
- Number questions: `<input type="number">` + optional unit toggle
- Chip questions: clickable pill buttons (selecting one auto-advances without needing Enter)
- Enter key / "Continue" button both advance the step
- Progress bar at top of card: `width = ((step + 1) / 7) × 100%`
- Slide animation: outgoing question slides left + fades out, incoming slides in from right

**Result card:**
- Animated days counter (same easing logic as `SpinCount` but triggered by a `useEffect` on result-card mount, not IntersectionObserver, since the card appears mid-scroll)
- Stats row: Current / Goal / Pace
- Tagline: "It's easier to get to your ideal form with our formulas" (white, small)
- Green "Get Healthy" button linking to `/register`
- "Recalculate" small text link resets to step 0

---

## Animations

- **Question transition:** CSS `@keyframes` slide-in from right + fade. Duration 280ms ease-out.
- **Card swap (quiz → result):** scale + fade transition on the card container. Duration 350ms.
- **Days count:** reuse existing `SpinCount` intersection-observer pattern, triggered on card swap.

---

## Internationalisation

The component uses `useTranslations("predictionTeaser")`. All new string keys are added to `messages/en.json`, `messages/es.json`, and `messages/ru.json`.

New keys needed:
```
predictionTeaser.q1, q2, q3, q4, q5, q6, q7
predictionTeaser.male, female
predictionTeaser.activitySedentary, activityLight, activityModerate, activityVery
predictionTeaser.heightUnit, weightUnit
predictionTeaser.pressEnter
predictionTeaser.resultTagline   ("It's easier to get to your ideal form with our formulas")
predictionTeaser.getHealthy      ("Get Healthy")
predictionTeaser.recalculate
```

---

## What Does NOT Change

- Left-hand copy block in `PredictionTeaser` (headline, subheadline, eyebrow)
- Section background, layout, and padding
- Dashboard `PredictionView` component
- Dashboard prediction page logic
- All other landing page sections

---

## Out of Scope

- Saving quiz answers to a database
- Pre-filling the dashboard profile from quiz answers
- Server-side calculation (all math is client-side in the component)
