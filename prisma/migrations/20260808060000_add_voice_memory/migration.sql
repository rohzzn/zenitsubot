-- CreateTable
CREATE TABLE "VoiceProfile" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "displayName" TEXT,
    "preferences" TEXT,
    "summary" TEXT,
    "firstHeardAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastHeardAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "turns" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "VoiceFact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "fact" TEXT NOT NULL,
    "inferred" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VoiceFact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "VoiceProfile" ("userId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VoiceExchange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "spoke" TEXT NOT NULL,
    "answered" TEXT,
    "guildId" TEXT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VoiceExchange_userId_fkey" FOREIGN KEY ("userId") REFERENCES "VoiceProfile" ("userId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "VoiceProfile_lastHeardAt_idx" ON "VoiceProfile"("lastHeardAt");

-- CreateIndex
CREATE INDEX "VoiceFact_userId_updatedAt_idx" ON "VoiceFact"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "VoiceFact_userId_topic_key" ON "VoiceFact"("userId", "topic");

-- CreateIndex
CREATE INDEX "VoiceExchange_userId_at_idx" ON "VoiceExchange"("userId", "at");

