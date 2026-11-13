// Does a reply end by asking the person something? Pure text helpers for the
// loop's answer-box conversion: a plain-text reply that ends in a question
// gets tappable answers (owner, 2026-11: "when it asks questions it need to
// give buttons to choose from or other for custom option").

/** What may follow the final "?" without changing what the sentence is: spaces, emoji, closing quotes and brackets, markdown marks. */
const TRAILING = /[\s"'”’»)\]*_~‍️\p{Extended_Pictographic}]+$/u;
const QUESTION_MARK = /[?？]$/;

function core(text: string): string {
  return typeof text === "string" ? text.replace(TRAILING, "") : "";
}

/**
 * The last sentence of the reply when it is a question, exactly as written
 * (without what trails it); null when the reply ends in a statement. A
 * question earlier in the text does not count: "Why fibre? It keeps you
 * full." ends in a statement. Neither does a question the reply only quotes
 * as an example to say ("Ask me \"what's for dinner?\" any time.") or a link.
 */
export function finalQuestion(text: string): string | null {
  const body = core(text).replace(/\s*[?？]$/, (m) => m.trim());
  if (!QUESTION_MARK.test(body)) return null;
  // The sentence starts after the last ., !, ?, … or line break that is followed by a space (so "2.5" does not split).
  const before = body.slice(0, -1);
  let start = 0;
  for (const m of before.matchAll(/[.!?？…]["'”’)\]*_]*\s+|\n+/g)) start = m.index + m[0].length;
  const sentence = body.slice(start).replace(/^[\s"'“‘«(\[*_~¿]+/u, (lead) => (lead.includes("¿") ? "¿" : "")).trim();
  if (!/\p{L}/u.test(sentence)) return null;
  if (/https?:\/\/\S*$/.test(sentence)) return null;
  return sentence;
}

/** True when the reply's final sentence asks the person something. */
export function endsWithQuestion(text: string): boolean {
  return finalQuestion(text) !== null;
}

const wordsOf = (text: string): string[] => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);

/**
 * Does the text already ask what `question` asks? True when one of its
 * question sentences shares most of the question's words (three letters or
 * more). The model sometimes writes its question in the reply and then passes
 * it, reworded, to ask_choices; writing it out again would show it twice.
 */
export function asksAlready(text: string, question: string): boolean {
  const wanted = [...new Set(wordsOf(question))];
  if (wanted.length < 2) return false;
  for (const sentence of (typeof text === "string" ? text : "").split(/(?<=[.!?？…])\s+|\n+/)) {
    if (!/[?？]/.test(sentence)) continue;
    const have = new Set(wordsOf(sentence));
    if (wanted.filter((w) => have.has(w)).length / wanted.length >= 0.6) return true;
  }
  return false;
}
