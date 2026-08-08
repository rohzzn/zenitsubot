-- CreateTable
CREATE TABLE "AnimeFollow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "anilistId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "coverUrl" TEXT,
    "lastEpisode" INTEGER NOT NULL DEFAULT 0,
    "addedBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "GameFollow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "appId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "lastNewsId" TEXT,
    "addedBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_GuildConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "modLogChannelId" TEXT,
    "welcomeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "welcomeChannelId" TEXT,
    "welcomeMessage" TEXT,
    "welcomeCard" BOOLEAN NOT NULL DEFAULT true,
    "autoRoleId" TEXT,
    "autoRoleEnabled" BOOLEAN NOT NULL DEFAULT false,
    "animeChannelId" TEXT,
    "gameChannelId" TEXT,
    "goodbyeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "goodbyeChannelId" TEXT,
    "goodbyeMessage" TEXT,
    "musicDefaultVolume" INTEGER NOT NULL DEFAULT 50,
    "musicIdleMinutes" INTEGER NOT NULL DEFAULT 5,
    "musicAutoplay" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_GuildConfig" ("createdAt", "goodbyeChannelId", "goodbyeEnabled", "goodbyeMessage", "guildId", "id", "modLogChannelId", "musicAutoplay", "musicDefaultVolume", "musicIdleMinutes", "updatedAt", "welcomeChannelId", "welcomeEnabled", "welcomeMessage") SELECT "createdAt", "goodbyeChannelId", "goodbyeEnabled", "goodbyeMessage", "guildId", "id", "modLogChannelId", "musicAutoplay", "musicDefaultVolume", "musicIdleMinutes", "updatedAt", "welcomeChannelId", "welcomeEnabled", "welcomeMessage" FROM "GuildConfig";
DROP TABLE "GuildConfig";
ALTER TABLE "new_GuildConfig" RENAME TO "GuildConfig";
CREATE UNIQUE INDEX "GuildConfig_guildId_key" ON "GuildConfig"("guildId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "AnimeFollow_guildId_idx" ON "AnimeFollow"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "AnimeFollow_guildId_anilistId_key" ON "AnimeFollow"("guildId", "anilistId");

-- CreateIndex
CREATE INDEX "GameFollow_guildId_idx" ON "GameFollow"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "GameFollow_guildId_appId_key" ON "GameFollow"("guildId", "appId");

