-- CreateTable
CREATE TABLE "ShopBillingEntitlement" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "shopifySubscriptionId" TEXT,
    "shopifyStatus" TEXT,
    "currentPeriodEnd" TIMESTAMP(3),
    "entitledUntil" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "frozenAt" TIMESTAMP(3),
    "test" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopBillingEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopBillingEntitlement_shop_key" ON "ShopBillingEntitlement"("shop");

-- CreateIndex
CREATE INDEX "ShopBillingEntitlement_shopifySubscriptionId_idx" ON "ShopBillingEntitlement"("shopifySubscriptionId");

-- CreateIndex
CREATE INDEX "ShopBillingEntitlement_entitledUntil_idx" ON "ShopBillingEntitlement"("entitledUntil");
