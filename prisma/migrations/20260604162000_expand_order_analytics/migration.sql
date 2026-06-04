ALTER TABLE "OrderAnalytics"
  ADD COLUMN "discountCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "taxCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "paidShippingCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "itemQuantity" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "uniqueProductCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "totalWeightGrams" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "customerId" TEXT,
  ADD COLUMN "customerOrderCount" INTEGER,
  ADD COLUMN "sourceName" TEXT,
  ADD COLUMN "financialStatus" TEXT,
  ADD COLUMN "fulfillmentStatus" TEXT,
  ADD COLUMN "shippingMethod" TEXT,
  ADD COLUMN "shippingCountry" TEXT,
  ADD COLUMN "shippingProvince" TEXT,
  ADD COLUMN "shippingCity" TEXT,
  ADD COLUMN "discountCodesJson" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "lineItemsJson" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "shippingLinesJson" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "paymentGatewayNamesJson" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "tagsJson" JSONB NOT NULL DEFAULT '[]';

CREATE INDEX "OrderAnalytics_shopId_sourceName_idx" ON "OrderAnalytics"("shopId", "sourceName");
CREATE INDEX "OrderAnalytics_shopId_shippingCountry_idx" ON "OrderAnalytics"("shopId", "shippingCountry");
