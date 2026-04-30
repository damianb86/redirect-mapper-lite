-- CreateTable
CREATE TABLE "CleanupRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "actorName" TEXT,
    "totalSelected" INTEGER NOT NULL DEFAULT 0,
    "redirectsTotal" INTEGER NOT NULL DEFAULT 0,
    "redirectsCreated" INTEGER NOT NULL DEFAULT 0,
    "redirectsFailed" INTEGER NOT NULL DEFAULT 0,
    "productsChanged" INTEGER NOT NULL DEFAULT 0,
    "productsFailed" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "conflicts" INTEGER NOT NULL DEFAULT 0,
    "lowConfidence" INTEGER NOT NULL DEFAULT 0,
    "planOverride" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "rolledBackAt" DATETIME
);

-- CreateTable
CREATE TABLE "CleanupRedirect" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cleanupId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "productImageUrl" TEXT,
    "productImageAlt" TEXT,
    "sourcePath" TEXT NOT NULL,
    "targetPath" TEXT NOT NULL,
    "ruleLabel" TEXT,
    "confidence" TEXT,
    "targetChoice" TEXT,
    "shopifyRedirectId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rolledBackAt" DATETIME,
    CONSTRAINT "CleanupRedirect_cleanupId_fkey" FOREIGN KEY ("cleanupId") REFERENCES "CleanupRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CleanupRun_shop_createdAt_idx" ON "CleanupRun"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "CleanupRun_shop_status_idx" ON "CleanupRun"("shop", "status");

-- CreateIndex
CREATE INDEX "CleanupRedirect_shop_sourcePath_idx" ON "CleanupRedirect"("shop", "sourcePath");

-- CreateIndex
CREATE INDEX "CleanupRedirect_shop_status_idx" ON "CleanupRedirect"("shop", "status");

-- CreateIndex
CREATE INDEX "CleanupRedirect_cleanupId_idx" ON "CleanupRedirect"("cleanupId");
