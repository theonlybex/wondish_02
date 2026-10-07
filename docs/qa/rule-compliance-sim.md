# Rule-compliance simulation

Run 2026-10-07T19:24:38.391Z · snapshot 2026-10-07T19:05:40.659Z · 509s

Real route handlers and planner, in-process, against a read-only snapshot (no browser, no writes, no model calls).

**Profiles:** 2835 — 105 single rules, 2701 rule pairs, 17 real-user combinations, 11 hand-built heavy combinations, 1 with every rule at once.
Pairs run the light services only (What to buy, taste ingredients, Clara post-filter).

**Result: PASS** — 0 violations, 0 service errors, 64 distinct suspects for review.

| Service | Profiles | Items checked | Violations | Errors | Suspect hits |
|---|---:|---:|---:|---:|---:|
| What to buy · Unlocks most | 2835 | 141712 | 0 | 0 | 709 |
| What to buy · By category | 2835 | 398032 | 0 | 0 | 1038 |
| What to buy · By cuisine | 2835 | 237743 | 0 | 0 | 687 |
| Taste · ingredient picker | 2835 | 213141 | 0 | 0 | 350 |
| Clara post-filter (cook-day · swap · fridge) | 2835 | 0 | 0 | 0 | 0 |
| Ingredients · dishes you can cook | 134 | 11036 | 0 | 0 | 75 |
| Taste · dish swiper | 134 | 17901 | 0 | 0 | 31 |
| Meal plan · week generation | 134 | 26126 | 0 | 0 | 53 |
| Meal plan · alternatives | 134 | 13814 | 0 | 0 | 25 |
| Meal plan · swap gate (whole library) | 134 | 2137234 | 0 | 0 | 618 |

## Suspects (engine allowed, name contains a banned term) — for review

Usually a deliberate exemption ("gluten-free bread", "almond milk", "decaf coffee"). Anything here that is NOT acceptable is a rule-data or engine gap.

| Rule | Banned term | Served item | Services | Hits |
|---|---|---|---|---:|
| diet:Vegan | milk | Almond milk | buy-value, buy-category, taste-ingredients, cookable, taste-dishes, meal-plan, alternatives, swap-gate | 270 |
| diet:Paleo | milk | Almond milk | buy-value, buy-category, taste-ingredients, cookable, taste-dishes, meal-plan, swap-gate | 263 |
| diet:Keto | rice | rice vinegar | buy-category, buy-cuisine, cookable, buy-value, meal-plan, swap-gate | 241 |
| diet:Dairy-free | milk | Almond milk | buy-value, buy-category, taste-ingredients, cookable, taste-dishes, meal-plan, alternatives, swap-gate | 236 |
| diet:Paleo | rice | rice vinegar | buy-category, buy-cuisine, cookable, buy-value, meal-plan | 235 |
| diet:Low-carb | rice | rice vinegar | buy-category, buy-cuisine, cookable, swap-gate, meal-plan | 233 |
| diet:Vegan | milk | Oat Milk | buy-value, buy-category, taste-ingredients, taste-dishes, swap-gate | 207 |
| diet:Dairy-free | milk | Oat Milk | buy-value, buy-category, taste-ingredients, swap-gate | 200 |
| condition:Chronic kidney disease – stage 3 | avocado | avocado oil | buy-category, taste-dishes, alternatives, swap-gate, meal-plan | 118 |
| avoid:Caffeine | black tea | decaf black tea | buy-value, cookable, taste-dishes, swap-gate, meal-plan, alternatives | 117 |
| diet:Keto | apple | Apple cider vinegar | buy-category, taste-dishes, meal-plan, alternatives, swap-gate, buy-value, cookable | 108 |
| diet:Vegan | milk | Coconut milk | buy-category, swap-gate | 82 |
| avoid:Alcohol | wine | red wine vinegar | buy-category, swap-gate | 81 |
| diet:Paleo | milk | Coconut milk | buy-category, swap-gate | 77 |
| diet:Vegan | milk | coconut milk | buy-cuisine | 77 |
| diet:Dairy-free | milk | Coconut milk | buy-category, swap-gate | 76 |
| diet:Gluten-free | gluten | Multigrain gluten-free, rice English muffins, | buy-value, swap-gate | 75 |
| diet:Gluten-free | muffins | Multigrain gluten-free, rice English muffins, | buy-value, swap-gate | 75 |
| diet:Paleo | milk | coconut milk | buy-cuisine | 75 |
| diet:Dairy-free | milk | coconut milk | buy-cuisine | 73 |
| diet:Pescatarian | chicken | meatless chicken | meal-plan, swap-gate | 72 |
| diet:Gluten-free | gluten | Potato & tapioca gluten-free crackers | buy-value, swap-gate | 68 |
| diet:Gluten-free | crackers | Potato & tapioca gluten-free crackers | buy-value, swap-gate | 68 |
| goal:Eat healthier | sugar | Sugar-free granola | swap-gate | 56 |
| avoid:Caffeine | coffee | Decaf coffee | cookable, swap-gate, meal-plan | 37 |
| diet:Gluten-free | gluten | Gluten-free granola | taste-dishes, meal-plan, alternatives, swap-gate | 31 |
| diet:Vegan | chicken | meatless chicken | meal-plan, swap-gate, cookable | 30 |
| goal:Improve energy | sugar | Sugar-free granola | swap-gate | 28 |
| diet:Vegetarian | chicken | meatless chicken | meal-plan, swap-gate | 25 |
| goal:Eat healthier | butter | Almond butter | cookable, swap-gate | 21 |
| avoid:Alcohol | wine | Red wine vinegar | swap-gate, cookable, meal-plan, taste-dishes, alternatives | 20 |
| diet:Pescatarian | beef | meatless beef strips | taste-dishes, alternatives, swap-gate | 20 |
| diet:Dairy-free | milk | Plain unsweetened almond milk yogurt | taste-dishes, alternatives, swap-gate | 18 |
| diet:Dairy-free | yogurt | Plain unsweetened almond milk yogurt | taste-dishes, alternatives, swap-gate | 18 |
| diet:Mediterranean | sugar | Sugar-free granola | swap-gate | 14 |
| diet:Vegan | milk | Plain unsweetened almond milk yogurt | swap-gate, cookable, meal-plan | 9 |
| diet:Vegan | yogurt | Plain unsweetened almond milk yogurt | swap-gate, cookable, meal-plan | 9 |
| diet:Gluten-free | gluten | Gluten-free chickpeas orzo pasta | swap-gate | 8 |
| diet:Gluten-free | pasta | Gluten-free chickpeas orzo pasta | swap-gate | 8 |
| diet:Gluten-free | orzo | Gluten-free chickpeas orzo pasta | swap-gate | 8 |
| goal:Muscle Gain | sugar | Sugar-free granola | swap-gate | 8 |
| diet:High-protein | sugar | Sugar-free granola | swap-gate | 7 |
| diet:Mediterranean | butter | Almond butter | cookable, alternatives, swap-gate | 7 |
| diet:Paleo | milk | Plain unsweetened almond milk yogurt | swap-gate, cookable, meal-plan | 7 |
| diet:Paleo | yogurt | Plain unsweetened almond milk yogurt | swap-gate, cookable, meal-plan | 7 |
| avoid:Red meat | beef | meatless beef strips | taste-dishes, swap-gate | 6 |
| diet:Vegan | butter | Almond butter | cookable, swap-gate | 6 |
| diet:Vegetarian | beef | meatless beef strips | alternatives, swap-gate | 6 |
| goal:Eat healthier | sugar | sugar-free granola | swap-gate | 6 |
| goal:Eat healthier | butter | unsalted creamy peanut butter | swap-gate | 5 |
| diet:Dairy-free | butter | Almond butter | cookable, alternatives, swap-gate | 4 |
| diet:Dairy-free | milk | plain unsweetened almond milk yogurt | swap-gate | 4 |
| diet:Dairy-free | yogurt | plain unsweetened almond milk yogurt | swap-gate | 4 |
| diet:Paleo | butter | Almond butter | cookable, swap-gate | 4 |
| goal:Improve energy | sugar | sugar-free granola | swap-gate | 4 |
| diet:Gluten-free | gluten | gluten-free multiple whole grain bread mix | taste-dishes, alternatives | 2 |
| diet:Gluten-free | bread | gluten-free multiple whole grain bread mix | taste-dishes, alternatives | 2 |
| diet:Gluten-free | gluten | Gluten-free chickpeas rotini pasta | swap-gate | 2 |
| diet:Gluten-free | pasta | Gluten-free chickpeas rotini pasta | swap-gate | 2 |
| diet:Gluten-free | rotini | Gluten-free chickpeas rotini pasta | swap-gate | 2 |
| diet:Dairy-free | butter | unsalted creamy peanut butter | swap-gate | 1 |
| diet:High-protein | sugar | sugar-free granola | swap-gate | 1 |
| diet:Mediterranean | sugar | sugar-free granola | swap-gate | 1 |
| diet:Mediterranean | butter | unsalted creamy peanut butter | swap-gate | 1 |

## Rules that ban no ingredient

These shape only Clara's prompt text (guidance), so no deterministic check can enforce them: Alzheimer's Disease, Aspirin-Exacerbated Respiratory Disease (AERD), Autoimmune Diseases, Cancer – after treatment, Cancer – during treatment, Chronic Diarrhea, Chronic Inflammatory Conditions, Constipation, Eczema, Foggy brain, GERD, Gastritis, Gut Candidiasis, Hair Shedding, IBD – active, IBD – in remission, IBS-C, IBS-D, IBS-M, Leaky Gut Syndrome, Migraine, Overweight, Recovering after illness/surgery, Respiratory Allergies, Rosacea, Seborrheic Dermatitis, Stroke, Lose weight + preserve muscle, Manage a health condition, Navigate my food restrictions, Save time on meal planning.

## Coverage notes (non-pair profiles)

Meal plans that could not fill every core slot from the library: 1.
- everything: 28 rows, core coverage 33%
