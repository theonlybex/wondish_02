// Tool-round budget. A "round" is one model turn that may execute tools; the
// loop always gets one final tools-free round on top, so total model calls per
// user message is at most maxToolRounds + 1. One user message is always ONE
// credit against CHAT_DAILY_FREE regardless of rounds (spec §8 Q2).

export const MAX_TOOL_ROUNDS_FREE = 2;
export const MAX_TOOL_ROUNDS_PREMIUM = 5;

export function maxToolRounds(isPremium: boolean): number {
  return isPremium ? MAX_TOOL_ROUNDS_PREMIUM : MAX_TOOL_ROUNDS_FREE;
}
