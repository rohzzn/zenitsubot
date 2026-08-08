-- CreateTable
CREATE TABLE "Audiobook" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fileHash" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "language" TEXT,
    "content" TEXT NOT NULL,
    "chapters" INTEGER NOT NULL,
    "seconds" INTEGER NOT NULL,
    "addedBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AudiobookPosition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chapter" INTEGER NOT NULL DEFAULT 0,
    "offset" REAL NOT NULL DEFAULT 0,
    "voice" TEXT NOT NULL DEFAULT 'Kore',
    "style" TEXT NOT NULL DEFAULT 'natural',
    "speed" REAL NOT NULL DEFAULT 1.0,
    "finished" BOOLEAN NOT NULL DEFAULT false,
    "listened" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AudiobookPosition_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Audiobook" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AudiobookBookmark" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chapter" INTEGER NOT NULL,
    "offset" REAL NOT NULL,
    "quote" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AudiobookBookmark_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Audiobook" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Audiobook_fileHash_key" ON "Audiobook"("fileHash");

-- CreateIndex
CREATE INDEX "Audiobook_createdAt_idx" ON "Audiobook"("createdAt");

-- CreateIndex
CREATE INDEX "AudiobookPosition_userId_updatedAt_idx" ON "AudiobookPosition"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AudiobookPosition_bookId_userId_key" ON "AudiobookPosition"("bookId", "userId");

-- CreateIndex
CREATE INDEX "AudiobookBookmark_userId_bookId_idx" ON "AudiobookBookmark"("userId", "bookId");

