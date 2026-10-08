// Reports about being offered food the diner cannot eat are always CRITICAL,
// whatever the model says (spec: "Safety override"). Deliberately generous:
// a false CRITICAL costs an admin a glance; a missed one buries an allergy.
const ALLERGY = /\b(allerg\w*|anaphyla\w*|epipen|celiac|coeliac|intoleran\w*)\b/i;
const ILLNESS = /\b(made me (?:sick|ill)|(?:allergic )?reaction|threw up|vomit\w*|hives)\b/i;
const RULE_WORDS = /\b(banned|not allowed|forbidden|i (?:can'?t|cannot|don'?t|do not) eat|i avoid)\b/i;
const DIET = /\b(vegan|vegetarian|pescatarian|halal|kosher|gluten[- ]free|dairy[- ]free|lactose[- ]free|keto|paleo)\b/i;
// Foods a diet or allergy rules out — the clash half of a diet report.
const EXCLUDED_FOOD =
  /\b(meat|chicken|beef|pork|bacon|ham|turkey|lamb|veal|sausages?|salami|pepperoni|steak|fish|salmon|tuna|cod|shrimp|prawns?|crab|lobster|seafood|shellfish|eggs?|cheese|milk|butter|yogh?urt|cream|gelatin|honey|gluten|wheat|bread|pasta|peanuts?|nuts?|sesame|soy)\b/i;
// Any food context — enough to make "banned" / "not allowed" about food.
const FOOD_CONTEXT = new RegExp(`${EXCLUDED_FOOD.source}|\\b(dish|meal|food|recipe|ingredients?|dinner|lunch|breakfast|snack)\\b`, "i");

export function isSafetyReport(raw: string): boolean {
  const text = raw.replace(/[‘’ʼ]/g, "'");
  if (ALLERGY.test(text) || ILLNESS.test(text)) return true;
  // "banned"/"not allowed" only about food — not "not allowed to change my email".
  if (RULE_WORDS.test(text) && FOOD_CONTEXT.test(text)) return true;
  // A diet named anywhere plus a food it excludes anywhere, in either order.
  return DIET.test(text) && EXCLUDED_FOOD.test(text);
}
