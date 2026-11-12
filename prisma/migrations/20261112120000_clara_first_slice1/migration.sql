-- Clara-first loop, slice 1. Additive only: new nullable or defaulted columns, no drops or alters.

-- AlterTable
ALTER TABLE "MealLog" ADD COLUMN "sodium" DOUBLE PRECISION;
ALTER TABLE "MealLog" ADD COLUMN "estimated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ClaraConversation" ADD COLUMN "dishName" TEXT;
ALTER TABLE "ClaraConversation" ADD COLUMN "cookedAt" TIMESTAMP(3);
ALTER TABLE "ClaraConversation" ADD COLUMN "recipe" JSONB;
