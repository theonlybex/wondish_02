# Nutrient levels for the Clara "Numbers" screen

Research only, written 2026-11-11. No code or database was changed. Every list
here needs the same clinician sign-off as the condition rules before it ships.

## What this is

The Numbers screen shows how much of each nutrient a person has eaten against a
daily target. Clara uses the same numbers to explain a dish suggestion ("you've
had little iron this week, lentils raise it").

Two limits on what the numbers mean:

- **They are intake, not body levels.** The app sees what was logged, not a
  blood test. Clara says "you've had little iron this week", never "your iron
  is low".
- **Nutrients support these functions; they do not control them.** A shortfall
  can contribute to tiredness. Fixing it does not promise more energy. The
  "supports" column uses the wording regulators allow on food labels (EU
  authorised health claims, Regulation 432/2012).

## The 18 levels

Targets are the US FDA Daily Values for adults, used as a starting point. Real
targets should come from age and sex reference intakes (for example iron is
8 mg for men and 18 mg for women aged 19 to 50).

| # | Level | Direction | Adult reference | What it supports | In the database today |
|---|---|---|---|---|---|
| 1 | Calories | match target | 2,000 kcal (personal target from the caloric engine) | Weight, energy | Yes: recipes, ingredients, meal log |
| 2 | Protein | get enough | 50 g | Muscles, bones, feeling full | Yes: recipes, ingredients, meal log |
| 3 | Carbohydrate | match target | 275 g | Blood sugar | Yes: recipes, ingredients, meal log |
| 4 | Fibre | get enough | 28 g | Digestion, steadier blood sugar after meals, cholesterol | Recipes and meal log only |
| 5 | Added sugar | stay under | 50 g | Weight, blood sugar | Recipes only |
| 6 | Saturated fat | stay under | 20 g | Blood cholesterol | Recipes only |
| 7 | Omega-3 (EPA + DHA) | get enough | 250 mg (EU claim level; no FDA value) | Heart, brain function | No |
| 8 | Sodium | stay under | 2,300 mg | Blood pressure | Recipes only |
| 9 | Potassium | get enough (stay under in later-stage kidney disease) | 4,700 mg | Blood pressure, muscles, nerves | No |
| 10 | Calcium | get enough | 1,300 mg | Bones, teeth, muscles | No |
| 11 | Iron | get enough | 18 mg | Less tiredness, focus, carrying oxygen in the blood, immunity | No |
| 12 | Magnesium | get enough | 420 mg | Less tiredness, mood, muscles, nerves, bones | No |
| 13 | Zinc | get enough | 11 mg | Immunity, focus, skin and hair | No |
| 14 | Iodine | get enough | 150 mcg | Thyroid, energy, focus | No |
| 15 | Vitamin D | get enough | 20 mcg | Bones, muscles, immunity | No |
| 16 | Vitamin B12 | get enough | 2.4 mcg | Less tiredness, mood, nerves, blood | No |
| 17 | Folate | get enough | 400 mcg DFE | Less tiredness, mood, blood, immunity | No |
| 18 | Vitamin C | get enough | 90 mg | Immunity, less tiredness, helps take up iron | No |

Add-on for kidney disease: **phosphorus** (stay under; reference 1,250 mg).
Later candidate: **water**, which supports focus and digestion but needs its own
logging.

## The areas at the bottom of the screen

Each area is "covered", "partly" or "short", worked out from the levels that
feed it. It reports nutrient coverage. It does not predict how a person feels.

| Area | Levels that feed it |
|---|---|
| Energy | Iron, vitamin B12, folate, magnesium, vitamin C, iodine, calories |
| Mood | Magnesium, vitamin B12, folate, vitamin C |
| Focus | Iron, iodine, zinc, omega-3 |
| Muscles | Protein, magnesium, potassium, calcium, vitamin D |
| Bones | Calcium, vitamin D, protein, magnesium, zinc |
| Heart and blood pressure | Sodium (less), saturated fat (less), potassium, omega-3, fibre |
| Blood sugar | Carbohydrate, fibre, added sugar (less) |
| Digestion | Fibre |
| Immunity | Vitamin C, vitamin D, zinc, iron, folate, vitamin B12 |
| Weight | Calories, protein, fibre |

Mood has the weakest evidence of the ten. The permitted wording for magnesium,
B12, folate and vitamin C is "contributes to normal psychological function",
which is not a claim about lifting low mood.

## Which levels show first (draft, for clinician review)

The screen shows four to six rows and puts the rest behind "Show all 18". The
condition is not named on the screen.

| Chosen at onboarding | Rows shown first |
|---|---|
| None | Calories, protein, fibre, added sugar, sodium, iron |
| High blood pressure | Sodium, potassium, fibre, saturated fat |
| Type 2 diabetes, prediabetes | Carbohydrate, fibre, added sugar, saturated fat |
| High cholesterol, heart disease | Saturated fat, fibre, omega-3, sodium |
| Kidney disease | Sodium, potassium, phosphorus, protein (all as limits) |
| PCOS, fatty liver | Added sugar, fibre, saturated fat, calories |
| Celiac disease | Iron, folate, vitamin B12, calcium, vitamin D |
| Pregnancy | Folate, iron, iodine, calcium |
| Vegan or vegetarian diet | Vitamin B12, iron, zinc, calcium, omega-3, iodine |
| GERD, IBS, migraine | The default set. For these the food rules matter more than the numbers |

The direction of a level can flip with the condition. Potassium is "get enough"
for blood pressure and "stay under" in later-stage kidney disease, so direction
has to be stored per person, not per nutrient.

## What it takes to build

- Today the database carries 8 of the 18. Recipes have calories, protein,
  carbs, fat, fibre, sodium, saturated fat and added sugars. Ingredients have
  calories, protein, carbs and fat. The meal log stores calories, protein,
  carbs, fat and fibre, so sodium is lost when a meal is logged.
- The other ten need per-ingredient data. `scripts/fetch-nutrition.mjs` already
  pulls from USDA FoodData Central, which holds potassium, calcium, iron,
  magnesium, zinc, vitamins D, B12, C and folate for most foods. It currently
  keeps macros only.
- Iodine and omega-3 are patchier in the USDA data and may have to wait.
- The meal log needs columns for every level that is shown, and dish pricing
  (`lib/staple-density.ts`) needs the same nutrients so a dish's numbers come
  from its amounts.
- Photo and free-text logs get their numbers from the model, so those rows
  should be marked as estimates.

## Sources

- US FDA, Daily Values on the Nutrition and Supplement Facts labels (2016 rule).
- EU Register of authorised health claims, Commission Regulation (EU) 432/2012.
- NIH Office of Dietary Supplements fact sheets, for age and sex reference intakes.
- WHO guideline on free sugars (under 10% of energy).
