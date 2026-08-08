-- CreateTable
CREATE TABLE "FeedSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "label" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'digest',
    "digestHour" INTEGER NOT NULL DEFAULT 9,
    "include" TEXT,
    "exclude" TEXT,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "pauseNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSentAt" DATETIME,
    "deliveredCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "FeedSubscription_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "FeedSource" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FeedSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "siteUrl" TEXT,
    "iconUrl" TEXT,
    "etag" TEXT,
    "lastModified" TEXT,
    "lastCheckedAt" DATETIME,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "disabledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "FeedItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "guid" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "author" TEXT,
    "summary" TEXT,
    "imageUrl" TEXT,
    "publishedAt" DATETIME,
    "seenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeedItem_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "FeedSource" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FeedDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subscriptionId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeedDelivery_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "FeedSubscription" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FeedDelivery_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "FeedItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "FeedSubscription_mode_paused_idx" ON "FeedSubscription"("mode", "paused");

-- CreateIndex
CREATE UNIQUE INDEX "FeedSubscription_userId_sourceId_key" ON "FeedSubscription"("userId", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedSource_url_key" ON "FeedSource"("url");

-- CreateIndex
CREATE INDEX "FeedSource_disabledAt_lastCheckedAt_idx" ON "FeedSource"("disabledAt", "lastCheckedAt");

-- CreateIndex
CREATE INDEX "FeedItem_sourceId_seenAt_idx" ON "FeedItem"("sourceId", "seenAt");

-- CreateIndex
CREATE UNIQUE INDEX "FeedItem_sourceId_guid_key" ON "FeedItem"("sourceId", "guid");

-- CreateIndex
CREATE INDEX "FeedDelivery_subscriptionId_sentAt_idx" ON "FeedDelivery"("subscriptionId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "FeedDelivery_subscriptionId_itemId_key" ON "FeedDelivery"("subscriptionId", "itemId");

