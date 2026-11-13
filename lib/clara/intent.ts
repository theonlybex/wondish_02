// The deterministic intent router for Clara's dish tools. Owner, 2026-11:
// "think of the way for the clara to use the tools we built for it, key words
// maybe or intent reading". The model was deciding whether to call
// dish_suggest, and sometimes answered in text — no dish card, no cooking mode.
//
// detectIntent reads ONLY the latest user message, with patterns: no model
// call, no I/O. When it names a tool, the chat service forces that tool on the
// first model round (tool_choice); the model still writes the arguments.
//
// Conservative by design. A false positive forces a dish card where the
// person wanted an answer; a miss just falls back to the model deciding, as
// before. So every pattern is anchored to the whole message, and anything
// that smells of a question about food, the saved plan, the log, numbers, a
// refusal or a report of something already eaten returns null.

export type ClaraIntent =
  | {
      tool: "dish_suggest";
      /** What they asked to cook, in their words ("eggs"). Absent for "what should I eat". */
      wants?: string;
      /** "something else" / "another one": only meaningful after a dish in this chat. */
      followUp?: true;
    }
  | {
      tool: "dish_plan_today";
      /** They did not say what today is like: "Anything happening today?" comes first. */
      askFirst?: true;
    };

/** Longer messages go to the model untouched: they carry more than a request for a dish. */
export const INTENT_MAX_CHARS = 200;
const WANTS_MAX_CHARS = 80;
const WANTS_MAX_WORDS = 6;

// ─── never ──────────────────────────────────────────────────────────────────

/** A refusal or a complaint is not a request for a dish. */
const NEGATION = /\b(?:don'?t|do not|didn'?t|did not|not|never|can'?t|cannot|won'?t|shouldn'?t|isn'?t|aren'?t|stop|instead of|rather not|hate|sick of|tired of)\b/;
/** Something already cooked or eaten belongs to logging. */
const PAST = /\b(?:i|we|i've|we've|i have|we have)\s+(?:just\s+|already\s+)?(?:cooked|ate|made|had|eaten|baked|fried|grilled|prepared|finished|skipped)\b|\b(?:yesterday|last night|earlier today|this morning i|already (?:ate|eaten|cooked|had))\b/;
/** The saved plan, the log, the journal, numbers, pills, weight, shopping: other tools own these. */
const OTHER_DOMAIN = /\b(?:meal plan|my plan|the plan|planned|log|logs|logged|logging|journal|diary|numbers?|levels?|pills?|supplements?|vitamins?|weight|weigh|kg|lbs?|calories|kcal|protein|carbs?|fat|fibre|fiber|sodium|salt|sugar|macros?|allerg\w*|swap|replace|shopping|grocer\w*|pantry|fridge|sleep|slept|mood|energy|symptoms?|goal|goals|profile|account|subscription)\b/;

// ─── tidying ────────────────────────────────────────────────────────────────

const LEAD_IN = /^(?:(?:hey|hi|hello|ok|okay|so|well|um|clara)[,!. ]+)*(?:(?:please|pls|plz)[, ]+)?(?:(?:can|could|would|will) (?:you|u) (?:please |pls )?)?/;
const MEAL = "(?:breakfast|brunch|lunch|dinner|supper|a snack|snack|tea)";
const TAIL = new RegExp(
  `(?:[, ]+(?:please|pls|plz|thanks|thank you|tonight|today|now|right now|for me|with me|for us|with us|together|quickly|real quick|from scratch|at home|step by step|for ${MEAL}|for tonight|this (?:morning|afternoon|evening)))+$`,
);

function tidy(message: string): string {
  return message
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s?.!…]+$/, "")
    .replace(LEAD_IN, "")
    .trim();
}

const withoutTail = (text: string): string => {
  // The leading space lets a text that is ONLY a tail ("with me") go too.
  let t = ` ${text}`;
  // "eggs with me please": the tail can stack.
  for (let i = 0; i < 4 && TAIL.test(t); i++) t = t.replace(TAIL, "");
  return t.trim();
};

// ─── cook a named thing ─────────────────────────────────────────────────────

const COOK_VERB = "(?:cook|make|prepare|bake|whip up)";
/** "help me cook …", "how do I make …", "I want to make …", "let's cook …", and the bare "cook … with me". */
const COOK_LEAD = new RegExp(
  `^(?:(?:i (?:want|need) to |i wanna |i(?:'d| would) (?:like|love) to |i(?:'m| am) (?:going to|gonna) |let'?s |let us |help me (?:to )?|show me how to |teach me (?:how )?to |tell me how to |walk me through how to |how (?:do|can|should|would) (?:i|we|you) |how to )${COOK_VERB}|${COOK_VERB})(?: (.*))?$`,
);
const RECIPE_FOR = /^(?:(?:give|show|find|get|send) me )?(?:a |an |the |some |any )?(?:good |easy |quick |simple |nice )?recipes? (?:for|of|with) (.+)$/;
const X_RECIPE = /^(?:a |an |the )?(.+) recipes?$/;

/** A meal or a filler word in place of a food: the tool, with no wants. */
const NOTHING_NAMED = new RegExp(
  `^(?:me |us )?(?:a |an |some |my |our )?(?:${MEAL}|something|anything|food|meals?|dish(?:es)?|something (?:quick|easy|simple|healthy|good|nice|tasty|new|light|warm|filling))$`,
);
/** "dinner with rice" → rice. */
const MEAL_WITH = new RegExp(`^(?:me |us )?(?:a |an |some |my )?(?:${MEAL}|meal|dish|something|food) (?:with|using|out of|from) (.+)$`);
/** Words that make the rest a question or a chore, not a food ("make it less salty", "make sure…"). */
const NOT_A_FOOD = /\b(?:it|this|that|these|those|them|him|her|sure|plan|list|note|reminder|change|decision|sense|time|room|day|week|mistake|difference|habit|friends?|money|entry|eat|eats|taste|tastes|last|stay|keep|work|feel|lose|gain|safely|properly|correctly|faster|better|healthier|cheaper|longer|without|if|when|until|enough|more|less|so|because|but|or)\b/;

function foodFrom(rest: string): { wants?: string } | null {
  let food = withoutTail(rest).replace(/^(?:me|us|up) /, "");
  if (food.length === 0 || NOTHING_NAMED.test(food)) return {};
  const withMeal = MEAL_WITH.exec(food);
  if (withMeal) food = withoutTail(withMeal[1]);
  if (food.length === 0 || NOTHING_NAMED.test(food)) return {};
  if (NOT_A_FOOD.test(food) || /[?:;,]/.test(food)) return null;
  if (food.length > WANTS_MAX_CHARS || food.split(" ").length > WANTS_MAX_WORDS) return null;
  return { wants: food };
}

// ─── what to eat, another dish, plan the day ────────────────────────────────

const WHEN = "(?: (?:tonight|now|right now|for tonight|this (?:morning|afternoon|evening)))?";
const FOR_MEAL = `(?: (?:for|as) (?:a |my |our )?${MEAL})?`;
const WHAT_TO_EAT = [
  new RegExp(`^what (?:should|can|could|shall|do) (?:i|we) (?:eat|cook|make|have)${FOR_MEAL}${WHEN}$`),
  new RegExp(`^what to (?:eat|cook|make|have)${FOR_MEAL}${WHEN}$`),
  new RegExp(
    `^(?:(?:give|get|find|show) me|suggest(?: me)?|recommend(?: me)?) (?:a |an |some |another )?(?:quick |easy |simple |healthy |good |new |light )?(?:${MEAL}|meal|dish|something)(?: (?:idea|ideas|suggestion|option))?(?: to (?:eat|cook|make))?${FOR_MEAL}${WHEN}$`,
  ),
  new RegExp(`^(?:any |some |a few )?(?:quick |easy |simple |healthy |good )?(?:${MEAL}|meal|dish|food) ideas?${WHEN}$`),
  /^i(?:'?m| am)(?: so| really| very| a bit)? (?:hungry|starving|peckish)$/,
];
const ANOTHER =
  /^(?:(?:give|show|get|find) me |i want |i'd like |how about |what about )?(?:something else|something different|another one|another|another dish|a different (?:one|dish)|different one|the next one|next one|other options?)$/;

const DAY = "(?:my day|the day|our day|today|today's (?:dishes|meals|food)|(?:my |our |the )?(?:dishes|meals|food|eating) for today|my whole day)";
const PLAN_DAY = [
  new RegExp(`^(?:plan|plan out|sort out|organi[sz]e) ${DAY}$`),
  /^what (?:should|can|shall|do) (?:i|we) (?:eat|cook|have|make) today$/,
  /^what to (?:eat|cook) today$/,
  /^(?:give me |make me )?(?:a )?(?:plan|menu) for today$/,
];
const PLAN_DAY_THEN = new RegExp(`^(?:plan|plan out|sort out|organi[sz]e) ${DAY}\\s*[,;:.–—-]\\s*(.+)$`);
/** What today is like, in their words: enough to skip "Anything happening today?". */
const OCCASION = /\b(?:guests?|party|visitors?|friends? (?:are )?(?:coming|over)|family (?:is )?(?:coming|over)|eating out|eat out|restaurant|dinner out|going out|normal day|nothing special|ordinary day|little time|no time|busy|in a rush|short on time|in a hurry)\b/;

/**
 * Which dish tool this message asks for, or null to leave it to the model.
 * Reads only the text given: the caller decides whether the dish skill is on,
 * whether this is an answer to a question Clara asked, and whether "something
 * else" has a dish before it.
 */
export function detectIntent(message: string): ClaraIntent | null {
  if (typeof message !== "string" || message.length > INTENT_MAX_CHARS) return null;
  const text = tidy(message);
  if (text.length === 0) return null;

  const polite = withoutTail(text);
  // Before the guards: "plan my day, I have no time" is a plan, not a refusal.
  if (PLAN_DAY.some((re) => re.test(text) || re.test(polite))) return { tool: "dish_plan_today", askFirst: true };
  const planThen = PLAN_DAY_THEN.exec(text);
  if (planThen && OCCASION.test(planThen[1])) return { tool: "dish_plan_today" };

  if (NEGATION.test(text) || PAST.test(text) || OTHER_DOMAIN.test(text)) return null;

  if (ANOTHER.test(polite)) return { tool: "dish_suggest", followUp: true };
  if (WHAT_TO_EAT.some((re) => re.test(polite))) return { tool: "dish_suggest" };

  const named = COOK_LEAD.exec(text)?.[1] ?? RECIPE_FOR.exec(polite)?.[1] ?? null;
  const cookBare = named === null && COOK_LEAD.test(text);
  if (named !== null || cookBare) {
    const food = foodFrom(named ?? "");
    return food ? { tool: "dish_suggest", ...food } : null;
  }
  const xRecipe = X_RECIPE.exec(polite);
  if (xRecipe) {
    const food = foodFrom(xRecipe[1]);
    return food?.wants !== undefined ? { tool: "dish_suggest", wants: food.wants } : null;
  }
  return null;
}

// ─── the meal for now ───────────────────────────────────────────────────────

/**
 * The meal a dish is for when they name none, from their local time of day
 * (minutes since local midnight): 04:00–10:29 breakfast, 10:30–14:59 lunch,
 * otherwise dinner.
 */
export function mealForLocalMinutes(minutes: number): "breakfast" | "lunch" | "dinner" {
  const m = ((Math.floor(minutes) % 1440) + 1440) % 1440;
  if (m >= 4 * 60 && m < 10 * 60 + 30) return "breakfast";
  if (m >= 10 * 60 + 30 && m < 15 * 60) return "lunch";
  return "dinner";
}
