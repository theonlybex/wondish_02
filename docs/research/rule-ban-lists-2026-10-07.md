# Ban lists for the 31 rules with no bans (research, 2026-10-07)

This is research only. No code or DB was changed. Every list below needs the same clinician
review as the 2026-09-11 backfills before an `--apply`.

**Matcher facts checked in `lib/diet-match.ts` (`exactBanPattern`) and used below:**
- Stems go both ways: `singularize("almonds") = "almond"`, so a ban on **"almonds"** also
  matches *almond milk*, *almond flour*, *almond butter* and *almond slivers*. The plant-base
  exemption only covers dairy and egg terms. The same goes for "oysters", which also matches
  *oyster sauce*, and for "cashews", "peanuts" and so on.
- A bare **"sprouts"** would match *Brussels sprouts*, so never ban it. Name the sprout.
- *"large raw shrimp"* is in the alias vocabulary and is cooked in the recipe. Never ban
  **"raw shrimp"**, and never ban a bare "raw".
- An ingredient name can't say whether something was pasteurized, cooked or served hot. Many
  food-safety rules only become bannable when the risk is in the product name ("sushi",
  "smoked salmon", "raw milk"). The rest has to go into prompt guidance (`CONDITION_GUIDANCE`).
- In line with the 2026-09-11 decision (sodium and potassium moved from hard bans to guidance),
  "limit" advice stays guidance in this report. It is not turned into a ban.

Evidence labels: **strong** means a government or society guideline says *avoid*.
**moderate** means guideline-endorsed but conditional or applying to a subgroup.
**commonly-advised** means standard clinical patient material with little trial evidence.

## 1. Summary

| Rule | Decision | # bans | Evidence | Key source |
|---|---|---|---|---|
| Alzheimer's Disease | C | 0 | weak for bans (pattern diets) | NIA |
| AERD | B | 0 | moderate (alcohol); salicylate diet not recommended | AAAAI Ask-the-Expert; Cardet 2014 |
| Autoimmune Diseases | C | 0 | weak (AIP diet) | FDA at-risk booklet (food safety only if immunosuppressed) |
| Cancer – after treatment | C | 0 | strong guidance, but it is "limit" advice | ACS 2020 guideline |
| Cancer – during treatment | **A** | 17 | strong (FDA/NCI food safety) | FDA booklet; NCI/MedlinePlus |
| Chronic Diarrhea | **A** + B | 6 | commonly-advised (NIDDK) | NIDDK diarrhea diet |
| Chronic Inflammatory Conditions | C | 0 | weak | n/a |
| Constipation | C | 0 | guidance is to *add* fibre | NIDDK constipation diet |
| Eczema | C | 0 | AAD advises *against* untested elimination | AAD |
| Foggy brain | C | 0 | not a diagnosis | n/a |
| GERD | B (exists) | 0 | ACG: no global elimination | ACG 2022 GERD guideline |
| Gastritis | B (exists) | 0 | NIDDK: diet not causal for most | NIDDK gastritis |
| Gut Candidiasis | C | 0 | no evidence for the anti-candida diet | n/a |
| Hair Shedding | C | 0 | deficiency-driven, nothing to ban | AAD |
| IBD – active | **A** | 24 | commonly-advised (low-residue in flares) | CCF; UCSF; NHS low-residue |
| IBD – in remission | C | 0 | IOIBD says "reduce", not avoid | IOIBD 2020 |
| IBS-C | B (exists) | 0 | moderate (low-FODMAP trial) | ACG 2021 IBS; Monash |
| IBS-D | B (exists) | 0 | moderate | ACG 2021 IBS; Monash |
| IBS-M | B (exists) | 0 | moderate | ACG 2021 IBS; Monash |
| Leaky Gut Syndrome | C | 0 | not a recognised diagnosis | Cleveland Clinic |
| Migraine | B (exists) | 0 | triggers are individual | American Migraine Foundation |
| Overweight | C | 0 | calorie and pattern advice | NIDDK / DGA |
| Recovering after illness/surgery | C | 0 | guidance exists (never restrict) | lib/food-map guidance |
| Respiratory Allergies | C | 0 | route to the Allergies profile | AAAAI (OAS) |
| Rosacea | B (new rules) | 0 | commonly-reported triggers, individual | National Rosacea Society; JCAD 2021 |
| Seborrheic Dermatitis | C | 0 | no dietary evidence | AAD |
| Stroke | C (+ guidance) | 0 | strong "limit sodium" advice, not avoid | AHA/ASA 2021 |
| Lose weight + preserve muscle (goal) | C | 0 | calorie and protein targets | n/a |
| Manage a health condition (goal) | C | 0 | meta-goal | n/a |
| Navigate my food restrictions (goal) | C | 0 | meta-goal | n/a |
| Save time on meal planning (goal) | C | 0 | not dietary | n/a |

Result: 3 rules get permanent bans, 8 are handled by trials (6 already have workbook-04 trials,
2 need new trial rules), and 20 get no ban.

---

## 2. Per-rule sections

### Cancer – during treatment: A (permanent while the rule is set)
**Why:** Chemotherapy and radiation lower white-cell counts. FDA and NCI patient guidance says
to *not eat* raw or undercooked meat, fish and eggs, refrigerated smoked seafood, unpasteurized
milk and juice, cold deli meats and raw sprouts. This is food-safety guidance, not the strict
"neutropenic diet". Trials found no benefit from a strict neutropenic diet over standard
food-safety rules, so the list below stays at the food-safety core.
Only items whose risk is visible in the ingredient name are listed. "Cook eggs and meat
thoroughly, reheat hot dogs until steaming, only pasteurized dairy and juice" must go into
`CONDITION_GUIDANCE` (there is no entry for this condition yet).

- `sushi`: strong
- `sashimi`: strong
- `ceviche`: strong (raw fish cured in acid only)
- `poke`: strong (raw fish). *Possible over-match:* almost never another food name. Keep.
- `carpaccio`: strong (raw beef or fish)
- `tartare`: strong (steak or tuna tartare). This does not match "tartar sauce".
- `raw oysters`: strong. *Do not use "oysters"*, which would hit "oyster sauce" (shelf-stable, cooked).
- `smoked salmon`: strong (FDA: refrigerated smoked seafood unless cooked)
- `lox`: strong
- `gravlax`: strong
- `raw milk`: strong
- `unpasteurized milk`: strong
- `raw milk cheese`: strong
- `unpasteurized juice`: strong
- `alfalfa sprouts`: strong (FDA: raw sprouts of any kind)
- `deli meat`: strong (cold cuts unless reheated until steaming; a recipe name usually means cold)
- `deli turkey`: strong. It matches the alias *"deli turkey breast"* (cold sandwich use).

Considered but **not** included, so leave them to guidance:
- `bean sprouts`: FDA allows them cooked thoroughly. They usually appear cooked in stir-fries in the library.
- `blue cheese`, `brie`, `camembert`, `queso fresco`, `feta`: the risk is *unpasteurized*
  versions. US retail versions are almost all pasteurized. Some cancer centres (Mount Sinai,
  MSK) advise avoiding mould-ripened and blue-veined cheese whatever the milk. If the clinician
  wants this, add them as commonly-advised.
- `hot dogs`, `pâté`, `kombucha`, `raw honey`: commonly-advised by some centres, weaker or
  heat-dependent.
- `raw shrimp` and bare `raw`: these over-match ("large raw shrimp" is cooked in the recipe).

Sources: https://www.fda.gov/food/people-risk-foodborne-illness/food-safety-older-adults-and-people-cancer-diabetes-hivaids-organ-transplants-and-autoimmune ·
https://www.mountsinai.org/health-library/selfcare-instructions/safe-eating-during-cancer-treatment ·
https://www.lls.org/managing-your-cancer/diet-guidelines-for-immunosuppressed-patients ·
https://www.cancer.gov/publications/patient-education/eating-hints

### Cancer – after treatment: C
**Why:** ACS and AICR survivor guidance follows cancer prevention advice. ACS says "it is best
not to drink alcohol" and to limit processed and red meat. Processed-meat advice is "limit",
not avoid. Alcohol is mostly a drinks question, and banning "wine" would hit "white cooking
wine". Food-safety bans no longer apply once counts recover, unless the person is still
immunosuppressed, which varies by person.
**Recommend:** guidance text such as "no alcoholic drinks; little or no processed meat; plenty
of vegetables, fruit, whole grains and legumes". Optionally offer the CURED_PROCESSED_MEAT
category as an opt-in.
Sources: https://www.cancer.org/cancer/risk-prevention/diet-physical-activity/acs-guidelines-nutrition-physical-activity-cancer-prevention.html ·
https://www.mdedge.com/clinicianreviews/article/223573/preventive-care/american-cancer-society-update-it-best-not-drink

### IBD – active: A (commonly-advised; flag for clinician review)
**Why:** In a flare, and especially with strictures, the Crohn's & Colitis Foundation, UCSF and
the NHS low-residue sheets advise avoiding hard, indigestible residue: whole nuts, seeds,
popcorn, corn kernels, dried fruit and coconut. Evidence is mostly expert opinion. Older
low-residue RCTs did not show fewer flares, but obstruction risk in stricturing Crohn's makes
this standard advice. Smooth forms (nut butters, nut milks, ground flax) are allowed, so pick
the names with care. Other flare advice (spicy, caffeine, fried, raw vegetables, prunes) is
individual or not name-matchable and belongs in guidance.

- `popcorn`: commonly-advised
- `walnuts`: commonly-advised (walnut oil is exempt)
- `pecans`: commonly-advised
- `pistachios`: commonly-advised. Also matches "unsalted pistachios", which is intended.
- `hazelnuts`: commonly-advised
- `almond slivers`, `sliced almonds`, `whole almonds`: commonly-advised. **Do not use
  "almonds"**, because its stem matches almond milk, flour and butter. *Gap:* the bare alias
  "almonds" stays unbanned. Accept that, or add a catalog-specific exception.
- `unsalted peanuts`, `roasted peanuts`: commonly-advised. **Not "peanuts"**, which would hit
  peanut butter (allowed).
- `dry unsalted roasted cashews`, `cashew nuts`: commonly-advised. **Not "cashews"**, which
  would hit cashew milk and cashew cream.
- `sunflower seeds`, `pumpkin seeds`, `poppy seeds`, `sesame seeds`: commonly-advised.
  Sesame oil is exempt.
- `chia seeds`: commonly-advised. *Over-match:* also hits "ground chia seeds" (ground seeds
  are lower residue). Acceptable.
- `corn kernels`, `kernel corn`: commonly-advised. These match "canned whole kernel corn" and
  "frozen or cooked sweet kernel corn". They do not touch cornstarch, cornmeal or corn tortillas.
- `raisins`, `dried cranberries`, `dried figs`, `prunes`: commonly-advised
- `shredded coconut`: commonly-advised. Not bare "coconut", which would hit coconut milk.

Sources: https://www.crohnscolitisfoundation.org/patientsandcaregivers/diet-and-nutrition ·
https://www.ucsfhealth.org/education/nutrition-tips-for-inflammatory-bowel-disease ·
https://www.gatesheadhealth.nhs.uk/resources/low-fibre-low-residue-dietary-advice/

### IBD – in remission: C
**Why:** IOIBD 2020 guidance says *reduce* red and processed meat (UC), emulsifiers and
thickeners (carrageenan, CMC), titanium dioxide and sulfites, and *avoid* trans fats. It also
says increase fruit, vegetables and marine omega-3s. Apart from trans fats, which are banned
in the US food supply anyway, nothing reaches the "avoid" bar. Remission diets should not be
restricted, because restriction raises malnutrition risk.
**Recommend:** guidance only, for example "Mediterranean-style; limit red/processed meat and
ultra-processed foods".
Sources: https://research.monash.edu/en/publications/dietary-guidance-from-the-international-organization-for-the-stud/ ·
https://www.health.harvard.edu/blog/i-have-inflammatory-bowel-disease-ibd-what-should-i-eat-2020051819799

### Chronic Diarrhea: A (small) + B
**Why:** NIDDK lists foods that make diarrhea worse: caffeine, high-fructose and high-lactose
foods, **sugar alcohols** and high-fat foods. For chronic diarrhea it says to avoid what
worsens *your* symptoms and to keep a food journal. Sugar alcohols are osmotic laxatives.
Banning them is low-cost and the effect does not depend on the person, so they get a
permanent ban. Everything else on the list is individual, so it goes to trials.
Workbook 04 has **no** trigger rules for factor 55 yet, so new rules are needed.

Bans:
- `sorbitol`: commonly-advised
- `xylitol`: commonly-advised
- `mannitol`: commonly-advised
- `maltitol`: commonly-advised
- `sugar-free candy`: commonly-advised
- `sugar-free gum`: commonly-advised

(None of these are in the current alias vocabulary, so expect a near-zero recipe effect. They
mainly guard Clara output.)
Proposed **new** trigger rules using existing categories: `FODMAP_LACTOSE`, `CAFFEINE`,
`HIGH_FAT_FRIED`, `FODMAP_EXCESS_FRUCTOSE`, `ALCOHOL`.
Source: https://www.niddk.nih.gov/health-information/digestive-diseases/diarrhea/eating-diet-nutrition

### GERD: B (trials already exist)
**Why:** The ACG 2022 guideline advises *against* routine global elimination of trigger foods
(conditional, low-quality evidence) and prefers identifying the person's own triggers. That is
exactly what the workbook-04 trials do.
Trials: `ACIDIC_CITRUS`, `ACIDIC_TOMATO`, `ALCOHOL`, `CHOCOLATE`, `CAFFEINE`, `HIGH_FAT`,
`MINT`, `SPICY`. The `CONDITION_GUIDANCE.gerd` text already covers meal timing.
Source: https://pmc.ncbi.nlm.nih.gov/articles/8754510 (Katz et al., ACG 2022)

### Gastritis: B (trials already exist)
**Why:** NIDDK says diet does not play an important role in causing most gastritis. The
exceptions are heavy alcohol, food allergy and some supplements. Symptom triggers are individual.
Trials: `ALCOHOL`, `COFFEE_CAFFEINE`, `CARBONATED`, `SPICY`, `HIGH_FAT_GREASY`.
Source: https://www.niddk.nih.gov/health-information/digestive-diseases/gastritis-gastropathy/eating-diet-nutrition

### IBS-C / IBS-D / IBS-M: B (trials already exist)
**Why:** ACG 2021 recommends a *limited trial* of low-FODMAP eating, then reintroduction to
find personal triggers. Monash says permanent FODMAP restriction is not intended and may harm
the gut microbiota. A permanent ban would be wrong here.
Trials (all three): `FODMAP_FRUCTANS`, `FODMAP_GOS`, `FODMAP_LACTOSE`,
`FODMAP_EXCESS_FRUCTOSE`, `FODMAP_POLYOLS`, plus portion or trial for `HIGH_FAT_FRIED`,
`CAFFEINE`, `ALCOHOL`, `CARBONATED`, `SPICY`.
Sources: https://journals.lww.com/ajg/fulltext/2021/01000/acg_clinical_guideline__management_of_irritable.11.aspx ·
https://www.monashfodmap.com/about-fodmap-and-ibs/

### Migraine: B (trials already exist)
**Why:** The American Migraine Foundation says the same food can trigger one person and not
another, or one person at one time and not another. It recommends elimination and
reintroduction, not blanket avoidance.
Trials: `ALCOHOL`, `CAFFEINE_INSTABILITY`, `CURED_PROCESSED_MEAT`, `AGED_CHEESE`, `MSG`,
`ARTIFICIAL_SWEETENERS`, `HISTAMINE_TYRAMINE_RICH`, `CHOCOLATE_UNCERTAIN`.
Source: https://americanmigrainefoundation.org/resource-library/migraine-and-diet/

### Aspirin-Exacerbated Respiratory Disease (AERD): B (new rule)
**Why:** The core of AERD is NSAID avoidance, which is not food. In a cohort, 83% of AERD
patients reported respiratory reactions to alcohol (Cardet et al. 2014), but not everyone
reacts. An AAAAI expert answer says a salicylate-free diet has no benefit, so do **not** ban
high-salicylate foods. The Brigham AERD Center suggests low omega-6 / high omega-3 eating as
guidance.
Proposed **new** trigger rule: `ALCOHOL` (existing category). No salicylate category.
Sources: https://www.aaaai.org/ask-the-expert/salicylate · https://samterssociety.org/aerd-alcohol ·
https://samterssociety.org/low-salicylate-diet

### Rosacea: B (new rules)
**Why:** In National Rosacea Society surveys people reported alcohol (52%), spicy food (45%),
some fruit and vegetables, hot drinks, cinnamaldehyde foods (cinnamon, tomato, citrus,
chocolate) and histamine-rich foods as triggers. These are self-reported and individual, so
they suit trials. Workbook 04 has no rules for factor 341.
Proposed **new** trigger rules with existing categories: `ALCOHOL`, `SPICY`,
`HISTAMINE_TYRAMINE_RICH`, `ACIDIC_TOMATO`, `ACIDIC_CITRUS`, `CHOCOLATE`.
Proposed **new** category `CINNAMALDEHYDE` with terms: `cinnamon`, `ground cinnamon`,
`cinnamon stick`. Bare "cinnamon" is fine because nothing else is named cinnamon.
"Hot drinks" can't be matched by name, so it goes in guidance.
Sources: https://pmc.ncbi.nlm.nih.gov/articles/PMC8794493/ · https://jcadonline.com/rosacea-diet-new-2021/ ·
https://www.rosacea.org/rosacea-review/1998/winter/grocery-list-helps-reduce-flare-ups

### Stroke: C (add guidance)
**Why:** The AHA/ASA 2021 secondary-prevention guideline recommends *limiting* sodium and/or a
Mediterranean diet. That is limit advice. On 2026-09-11 the app already moved sodium bans to
guidance for Hypertension and Heart Disease, because hard bans collapsed the recipe pool. Stroke
should be treated the same way. There is **no** `CONDITION_GUIDANCE` entry for stroke today,
so add one, for example "Mediterranean pattern; keep sodium low; no cured meats or salty
sauces; olive oil over butter".
Sources: https://professional.heart.org/en/science-news/2021-guideline-for-the-prevention-of-stroke-in-patients-with-stroke-and-transient-ischemic-attack/top-things-to-know

### Eczema: C
**Why:** The AAD says changing diet seldom helps eczema and that elimination without testing
can cause malnutrition, especially in children. Testing is advised only for immediate reactions
or uncontrolled moderate-to-severe disease. Confirmed allergens belong in the Allergies profile.
Sources: https://www.aad.org/public/diseases/eczema/childhood/treating/food-fix ·
https://www.aad.org/public/diseases/eczema/childhood/treating/foods-trigger

### Respiratory Allergies: C
**Why:** Pollen-food (oral allergy) syndrome reactions depend on the person's pollen and are
usually to *raw* fruit and vegetables. Cooking typically prevents them, and name matching can't
tell raw from cooked. Any confirmed food allergy goes in the Allergies profile. Workbook 04 has
no trigger rules for factor 1.
Source: https://www.aaaai.org/tools-for-the-public/conditions-library/allergies/oral-allergy-syndrome

### Constipation: C
**Why:** NIDDK advice is to *add* fibre and fluids. It says to limit low-fibre processed foods,
which is not an avoid rule. A fibre target fits Clara guidance better than a ban.
Source: https://www.niddk.nih.gov/health-information/digestive-diseases/constipation/eating-diet-nutrition

### Alzheimer's Disease: C
**Why:** NIA says evidence for diet changes such as MIND or Mediterranean is mixed. These are
whole-diet patterns with "limit" components (fried food, pastries, butter, red meat), not
avoid lists. Weight loss and low appetite are bigger risks than any single food.
Source: https://www.nia.nih.gov/health/alzheimers-and-dementia/what-do-we-know-about-diet-and-prevention-alzheimers-disease

### Autoimmune Diseases: C
**Why:** This covers many diseases. The Autoimmune Protocol diet has only small, uncontrolled
studies behind it. Celiac has its own rule. FDA food-safety advice applies to people on
immunosuppressants, but that depends on medication and the app can't infer it. At most add a
guidance line ("if on immunosuppressants, follow food-safety rules").
Source: https://www.fda.gov/food/people-risk-foodborne-illness/food-safety-older-adults-and-people-cancer-diabetes-hivaids-organ-transplants-and-autoimmune

### Chronic Inflammatory Conditions: C
**Why:** Not a single diagnosis. "Anti-inflammatory" eating (Mediterranean) is a pattern with
limits, not avoids. Guidance only.

### Foggy brain: C
**Why:** A symptom, not a diagnosis. There is no clinical source for food bans. Guidance at most
(steady blood sugar, hydration). If the team wants, `CAFFEINE_INSTABILITY` could be offered as
an opt-in trial.

### Gut Candidiasis: C
**Why:** "Anti-candida" diets (no sugar, yeast or fermented foods) have no RCT support for
intestinal candida overgrowth in otherwise healthy people. Invasive candidiasis is treated with
antifungals, not diet. **Naming flag:** `lib/workbooks/condition-map.ts` maps factor 57 to
`"Candidiasis"`, but the rule is named `"Gut Candidiasis"`. Check that phase C found it, since
it logs `our condition "..." not in DB`.

### Hair Shedding: C
**Why:** Diet-related shedding comes from *too little* (protein, iron, calories, crash
dieting). The AAD also warns about excess vitamin A and selenium supplements. There is nothing
to ban in recipes. Guidance should say adequate protein and iron and no aggressive calorie cut.
Source: https://www.aad.org/public/diseases/hair-loss/insider/shedding

### Leaky Gut Syndrome: C
**Why:** Cleveland Clinic says it is not a recognised medical diagnosis. Increased permeability
is real in some GI diseases, but it isn't established as a cause of other conditions. There is
no evidence base for bans.
Source: https://my.clevelandclinic.org/health/diseases/22724-leaky-gut-syndrome

### Overweight: C
**Why:** NIDDK and the Dietary Guidelines advise a calorie deficit and *limiting* sugary drinks
and ultra-processed foods. The caloric engine already handles the deficit. Bans would duplicate
the Type 2 Diabetes list and shrink the recipe pool for no gain.
Source: https://www.niddk.nih.gov/health-information/weight-management/healthy-eating-physical-activity-for-life

### Recovering after illness/surgery: C
**Why:** The existing `CONDITION_GUIDANCE` says "never cut calories during recovery". Bans would
reduce intake when it matters most. Specific post-op diets (for example after bowel surgery) are
procedure-specific and set by the surgical team.

### Seborrheic Dermatitis: C
**Why:** The AAD and dermatology literature give no dietary trigger guidance. Treatment is
topical antifungal or anti-inflammatory.
Source: https://www.aad.org/public/diseases/a-z/seborrheic-dermatitis-treatment

### Goals: Lose weight + preserve muscle · Manage a health condition · Navigate my food restrictions · Save time on meal planning: C
**Why:** None of these are dietary restrictions. "Lose weight + preserve muscle" is handled by
calorie and protein targets: a deficit plus high protein and resistance training, not food
bans. "Manage a health condition" and "Navigate my food restrictions" are meta-goals; the
actual conditions, allergies and avoids carry the bans. "Save time" affects recipe complexity,
not ingredients. Adding bans here would double-count or remove food for no reason.

---

## 3. Machine-readable (decision A only)

`motivations` is empty on purpose, since no goal gets a ban.

```json
{
  "conditions": {
    "Cancer – during treatment": [
      "sushi", "sashimi", "ceviche", "poke", "carpaccio", "tartare",
      "raw oysters", "smoked salmon", "lox", "gravlax",
      "raw milk", "unpasteurized milk", "raw milk cheese", "unpasteurized juice",
      "alfalfa sprouts", "deli meat", "deli turkey"
    ],
    "IBD – active": [
      "popcorn", "walnuts", "pecans", "pistachios", "hazelnuts",
      "almond slivers", "sliced almonds", "whole almonds",
      "unsalted peanuts", "roasted peanuts", "cashew nuts", "dry unsalted roasted cashews",
      "sunflower seeds", "pumpkin seeds", "poppy seeds", "sesame seeds", "chia seeds",
      "corn kernels", "kernel corn",
      "raisins", "dried cranberries", "dried figs", "prunes", "shredded coconut"
    ],
    "Chronic Diarrhea": [
      "sorbitol", "xylitol", "mannitol", "maltitol", "sugar-free candy", "sugar-free gum"
    ]
  },
  "motivations": {}
}
```
