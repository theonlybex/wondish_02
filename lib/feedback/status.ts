// What a reporter sees for their report: its issue's status, or New while untriaged.
export const USER_STATUS_LABEL = { PENDING: "New", NEW: "New", INVESTIGATING: "Looking into it", FIXED: "Fixed", WONT_FIX: "Won't fix" } as const;
export type UserStatus = keyof typeof USER_STATUS_LABEL;
