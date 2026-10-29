-- Clara chat upgrade: saved conversations, messages and member memory. Additive; three new tables only.

-- CreateTable
CREATE TABLE "ClaraConversation" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "surface" TEXT NOT NULL DEFAULT 'unknown',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClaraConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaraMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "choices" JSONB,
    "surface" TEXT NOT NULL DEFAULT 'unknown',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaraMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaraMemory" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "surface" TEXT NOT NULL DEFAULT 'unknown',
    "conversationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaraMemory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClaraConversation_patientId_updatedAt_idx" ON "ClaraConversation"("patientId", "updatedAt");

-- CreateIndex
CREATE INDEX "ClaraMessage_conversationId_createdAt_idx" ON "ClaraMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "ClaraMemory_patientId_createdAt_idx" ON "ClaraMemory"("patientId", "createdAt");

-- AddForeignKey
ALTER TABLE "ClaraConversation" ADD CONSTRAINT "ClaraConversation_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaraMessage" ADD CONSTRAINT "ClaraMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ClaraConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaraMemory" ADD CONSTRAINT "ClaraMemory_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaraMemory" ADD CONSTRAINT "ClaraMemory_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ClaraConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
