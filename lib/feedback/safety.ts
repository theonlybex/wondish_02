// Reports about being offered food the diner cannot eat are always CRITICAL,
// whatever the model says (spec: "Safety override").
const ALLERGY = /\b(allerg\w*|anaphyla\w*|epipen|celiac|coeliac|intoleran\w*)\b/i;
const RULE_BREAK = /\b(banned|not allowed|i (?:can'?t|cannot|don'?t) eat|made me (?:sick|ill)|reaction)\b/i;
const DIET_CLASH = /\b(vegan|vegetarian|pescatarian|halal|kosher|gluten[- ]free|dairy[- ]free)\b[^.!?]{0,80}\b(meat|chicken|beef|pork|bacon|fish|shrimp|egg|eggs|cheese|milk|gelatin|ham|turkey|gluten|wheat)\b/i;

export function isSafetyReport(text: string): boolean {
  return ALLERGY.test(text) || RULE_BREAK.test(text) || DIET_CLASH.test(text);
}
