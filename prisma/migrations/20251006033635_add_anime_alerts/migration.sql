-- CreateTable
CREATE TABLE "GuildConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "modLogChannelId" TEXT,
    "welcomeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "welcomeChannelId" TEXT,
    "goodbyeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "goodbyeChannelId" TEXT,
    "musicDefaultVolume" INTEGER NOT NULL DEFAULT 50,
    "musicIdleMinutes" INTEGER NOT NULL DEFAULT 5,
    "musicAutoplay" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "dueAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "ReactionRole" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AnimeAlert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "animeId" TEXT NOT NULL,
    "animeName" TEXT NOT NULL,
    "lastEpisode" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "GuildConfig_guildId_key" ON "GuildConfig"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "AnimeAlert_guildId_animeId_key" ON "AnimeAlert"("guildId", "animeId");
