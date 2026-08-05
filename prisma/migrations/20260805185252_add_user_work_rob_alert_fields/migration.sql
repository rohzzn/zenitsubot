/*
  Warnings:

  - You are about to drop the `StreamAlert` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `lastRep` on the `UserEconomy` table. All the data in the column will be lost.
  - Added the required column `userId` to the `AnimeAlert` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "StreamAlert_guildId_platform_streamerId_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "StreamAlert";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "bank" INTEGER NOT NULL DEFAULT 0,
    "linkedRolesVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AnimeAlert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "animeId" TEXT NOT NULL,
    "animeName" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "lastEpisode" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Alerts created before this column existed have no known owner. Backfill with
-- an empty string; the checker skips the mention when userId is blank.
INSERT INTO "new_AnimeAlert" ("animeId", "animeName", "channelId", "createdAt", "guildId", "id", "lastEpisode", "userId") SELECT "animeId", "animeName", "channelId", "createdAt", "guildId", "id", "lastEpisode", '' FROM "AnimeAlert";
DROP TABLE "AnimeAlert";
ALTER TABLE "new_AnimeAlert" RENAME TO "AnimeAlert";
CREATE INDEX "AnimeAlert_userId_idx" ON "AnimeAlert"("userId");
CREATE UNIQUE INDEX "AnimeAlert_guildId_animeId_key" ON "AnimeAlert"("guildId", "animeId");
CREATE TABLE "new_UserEconomy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "coins" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 1,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "lastDaily" DATETIME,
    "lastWork" DATETIME,
    "lastRob" DATETIME,
    "totalWagered" INTEGER NOT NULL DEFAULT 0,
    "totalWon" INTEGER NOT NULL DEFAULT 0,
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_UserEconomy" ("coins", "createdAt", "gamesPlayed", "id", "lastDaily", "level", "totalWagered", "totalWon", "updatedAt", "userId", "xp") SELECT "coins", "createdAt", "gamesPlayed", "id", "lastDaily", "level", "totalWagered", "totalWon", "updatedAt", "userId", "xp" FROM "UserEconomy";
DROP TABLE "UserEconomy";
ALTER TABLE "new_UserEconomy" RENAME TO "UserEconomy";
CREATE UNIQUE INDEX "UserEconomy_userId_key" ON "UserEconomy"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "User_userId_key" ON "User"("userId");
