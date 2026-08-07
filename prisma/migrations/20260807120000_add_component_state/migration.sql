-- CreateTable
CREATE TABLE "ComponentState" (
    "messageId" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "ComponentState_expiresAt_idx" ON "ComponentState"("expiresAt");

