import { cache } from "react";
import { prisma } from "./db";

// Per-request cached account fetch. React.cache() deduplicates calls with the
// same userId within one server render, so layout + page share one DB round trip.
export const getAccount = cache((userId: string) =>
  prisma.account.findUnique({
    where: { clerkId: userId },
    include: { subscription: true, roles: { include: { role: true } } },
  })
);

// Fetches the patient keyed directly by clerkId so it can run in parallel
// with getAccount — no need to wait for account.id first.
export const getOverviewPatient = cache((userId: string) => {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  return prisma.patient.findFirst({
    where: { account: { clerkId: userId } },
    include: {
      journalEntries: {
        orderBy: { date: "desc" },
        take: 7,
        include: { meals: true },
      },
      menus: {
        where: { date: { gte: todayStart, lt: todayEnd } },
        include: { recipe: true, mealType: true },
      },
    },
  });
});
