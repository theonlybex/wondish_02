// Saving a person's "at home" and favourite foods: the pure part.
export interface SavePlan { pantryAdd: string[]; pantryRemove: string[]; likeUpsert: string[]; likeDelete: string[] }

/** Pure. `visible`: ids the screen shows. `current`: pantry ids and every preference row for the patient. */
export function planSave(
  visible: ReadonlySet<string>,
  current: { pantry: ReadonlySet<string>; liked: ReadonlyMap<string, boolean> },
  body: { atHome: readonly string[]; favorites: readonly string[] },
): SavePlan {
  const atHome = new Set(body.atHome);
  const favorites = new Set(body.favorites);
  const plan: SavePlan = { pantryAdd: [], pantryRemove: [], likeUpsert: [], likeDelete: [] };
  for (const id of visible) {
    const inPantry = current.pantry.has(id);
    if (atHome.has(id) && !inPantry) plan.pantryAdd.push(id);
    if (!atHome.has(id) && inPantry) plan.pantryRemove.push(id);
    const isLiked = current.liked.get(id) === true;
    if (favorites.has(id) && !isLiked) plan.likeUpsert.push(id);
    if (!favorites.has(id) && isLiked) plan.likeDelete.push(id);
  }
  return plan;
}

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/** null when the body is not `{ atHome: string[], favorites: string[] }`. */
export function parseSaveBody(raw: unknown): { atHome: string[]; favorites: string[] } | null {
  if (!raw || typeof raw !== "object") return null;
  const { atHome, favorites } = raw as { atHome?: unknown; favorites?: unknown };
  if (!isStrings(atHome) || !isStrings(favorites)) return null;
  return { atHome, favorites };
}
