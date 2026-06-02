-- CreateTable
CREATE TABLE "OrderAnalytics" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "orderName" TEXT,
    "orderCreatedAt" TIMESTAMP(3) NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "subtotalCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "shippingPriceCents" INTEGER NOT NULL DEFAULT 0,
    "shippingDiscountCents" INTEGER NOT NULL DEFAULT 0,
    "freeShippingApplied" BOOLEAN NOT NULL DEFAULT false,
    "shippingProtectionCents" INTEGER NOT NULL DEFAULT 0,
    "shippingProtectionPurchased" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderAnalytics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderAnalytics_shopId_shopifyOrderId_key" ON "OrderAnalytics"("shopId", "shopifyOrderId");

-- CreateIndex
CREATE INDEX "OrderAnalytics_shopId_orderCreatedAt_idx" ON "OrderAnalytics"("shopId", "orderCreatedAt");

-- CreateIndex
CREATE INDEX "OrderAnalytics_shopId_freeShippingApplied_idx" ON "OrderAnalytics"("shopId", "freeShippingApplied");

-- AddForeignKey
ALTER TABLE "OrderAnalytics" ADD CONSTRAINT "OrderAnalytics_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
