// Pure decisions behind the web Clara chat (components/dish-checker/
// DishCheckerClient.tsx), kept here so they are testable and match iOS.

/** Same window as iOS ChatViewModel.resumeWindow: reopen a chat touched within 12 hours. */
export const RESUME_WINDOW_MS = 12 * 60 * 60 * 1000;

/**
 * On first load, the chat to reopen: the list's first item (server order,
 * newest first) when it was updated less than 12 hours ago. Otherwise null,
 * meaning start on a new chat.
 */
export function pickResumeId(items: { id: string; updatedAt: string }[], nowMs: number): string | null {
  const newest = items[0];
  if (!newest) return null;
  const updated = Date.parse(newest.updatedAt);
  if (Number.isNaN(updated)) return null;
  return nowMs - updated < RESUME_WINDOW_MS ? newest.id : null;
}

/**
 * The one message whose "Try again" is live: the latest, and only when it
 * failed. A retry on an older bubble would re-send text after later turns,
 * and the server de-dups only an identical TRAILING user message, so the
 * screen and the saved chat would diverge.
 */
export function retryableKey(messages: { key: string; retryText?: string }[]): string | null {
  const last = messages[messages.length - 1];
  return last?.retryText ? last.key : null;
}
