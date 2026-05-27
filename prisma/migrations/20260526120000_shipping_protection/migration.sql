-- CreateEnum
CREATE TYPE "ShippingProtectionPricingMode" AS ENUM ('TIERED', 'FORMULA');

-- CreateTable
CREATE TABLE "ShippingProtection" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "pricingMode" "ShippingProtectionPricingMode" NOT NULL DEFAULT 'TIERED',
    "productTitle" TEXT NOT NULL DEFAULT 'Shipping Protection',
    "widgetHeading" TEXT NOT NULL DEFAULT 'Shipping protection',
    "widgetDescription" TEXT NOT NULL DEFAULT 'Protect your order from loss, damage, or theft.',
    "optInLabel" TEXT NOT NULL DEFAULT 'Add shipping protection',
    "defaultSelected" BOOLEAN NOT NULL DEFAULT false,
    "tiersJson" JSONB NOT NULL DEFAULT '[{"minCents":0,"maxCents":1000,"amountCents":100},{"minCents":1000,"maxCents":3000,"amountCents":300},{"minCents":3000,"maxCents":6000,"amountCents":500},{"minCents":6000,"maxCents":null,"amountCents":700}]',
    "formulaJson" JSONB NOT NULL DEFAULT '{"amountCents":100,"everyCents":1000,"minChargeCents":100,"maxChargeCents":1500}',
    "productId" TEXT,
    "variantMapJson" JSONB NOT NULL DEFAULT '{}',
    "syncError" TEXT,
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingProtection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShippingProtection_shopId_key" ON "ShippingProtection"("shopId");

-- CreateIndex
CREATE INDEX "ShippingProtection_shopId_idx" ON "ShippingProtection"("shopId");

-- AddForeignKey
ALTER TABLE "ShippingProtection" ADD CONSTRAINT "ShippingProtection_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
