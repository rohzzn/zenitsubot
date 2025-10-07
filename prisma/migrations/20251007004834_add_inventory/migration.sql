-- CreateTable
CREATE TABLE "UserInventory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "itemType" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "equipped" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "UserInventory_userId_idx" ON "UserInventory"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserInventory_userId_itemId_key" ON "UserInventory"("userId", "itemId");
