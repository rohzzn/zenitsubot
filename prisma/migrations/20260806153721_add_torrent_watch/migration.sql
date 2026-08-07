-- CreateTable
CREATE TABLE "TorrentWatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL DEFAULT '',
    "userId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "category" TEXT,
    "resolution" TEXT,
    "minSeeders" INTEGER NOT NULL DEFAULT 0,
    "seenIds" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastCheckedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "TorrentWatch_active_idx" ON "TorrentWatch"("active");

-- CreateIndex
CREATE INDEX "TorrentWatch_userId_idx" ON "TorrentWatch"("userId");
