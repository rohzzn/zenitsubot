-- AlterTable
ALTER TABLE "GuildConfig" ADD COLUMN "welcomeMessage" TEXT;

-- CreateTable
CREATE TABLE "UserEconomy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "coins" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 1,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "lastDaily" DATETIME,
    "lastRep" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "StreamAlert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "streamerId" TEXT NOT NULL,
    "streamerName" TEXT NOT NULL,
    "lastNotified" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "UserEconomy_userId_guildId_key" ON "UserEconomy"("userId", "guildId");

-- CreateIndex
CREATE UNIQUE INDEX "StreamAlert_guildId_platform_streamerId_key" ON "StreamAlert"("guildId", "platform", "streamerId");
