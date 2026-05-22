CREATE TYPE "BillingStatus" AS ENUM ('INACTIVE', 'PENDING', 'ACTIVE', 'CANCELLED', 'FROZEN', 'DECLINED', 'EXPIRED');
CREATE TYPE "ApplyMode" AS ENUM ('CHEAPEST_ELIGIBLE', 'MATCHING_TITLE', 'ALL_ELIGIBLE');
CREATE TYPE "ShippingTitleMatchType" AS ENUM ('NONE', 'CONTAINS', 'EXACT', 'STARTS_WITH', 'REGEX');

CREATE TABLE "Shop" (
  "id" TEXT NOT NULL,
  "shopDomain" TEXT NOT NULL,
  "accessTokenEncrypted" TEXT,
  "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "uninstalledAt" TIMESTAMP(3),
  "billingStatus" "BillingStatus" NOT NULL DEFAULT 'INACTIVE',
  "subscriptionId" TEXT,
  "planName" TEXT,
  "trialEndsAt" TIMESTAMP(3),
  CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Session" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "isOnline" BOOLEAN NOT NULL DEFAULT false,
  "scope" TEXT,
  "expires" TIMESTAMP(3),
  "accessToken" TEXT NOT NULL,
  "userId" BIGINT,
  "firstName" TEXT,
  "lastName" TEXT,
  "email" TEXT,
  "accountOwner" BOOLEAN NOT NULL DEFAULT false,
  "locale" TEXT,
  "collaborator" BOOLEAN DEFAULT false,
  "emailVerified" BOOLEAN DEFAULT false,
  "refreshToken" TEXT,
  "refreshTokenExpires" TIMESTAMP(3),
  CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RuleSet" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "name" TEXT NOT NULL DEFAULT 'No stacking free shipping',
  "minSubtotalCents" INTEGER NOT NULL DEFAULT 40000,
  "maxWeightGrams" INTEGER NOT NULL DEFAULT 13608,
  "maxQuantity" INTEGER NOT NULL DEFAULT 6,
  "blockDiscountCodes" BOOLEAN NOT NULL DEFAULT true,
  "blockOrderDiscounts" BOOLEAN NOT NULL DEFAULT true,
  "blockProductDiscounts" BOOLEAN NOT NULL DEFAULT true,
  "blockShippingDiscounts" BOOLEAN NOT NULL DEFAULT true,
  "applyMode" "ApplyMode" NOT NULL DEFAULT 'CHEAPEST_ELIGIBLE',
  "shippingTitleMatchType" "ShippingTitleMatchType" NOT NULL DEFAULT 'CONTAINS',
  "shippingTitleMatchValue" TEXT,
  "excludedTitleTerms" JSONB NOT NULL DEFAULT '["Next Day", "Overnight", "Express", "Air"]',
  "configJson" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RuleSet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventLog" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "metadataJson" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Shop_shopDomain_key" ON "Shop"("shopDomain");
CREATE INDEX "Shop_billingStatus_idx" ON "Shop"("billingStatus");
CREATE INDEX "Session_shop_idx" ON "Session"("shop");
CREATE INDEX "RuleSet_shopId_idx" ON "RuleSet"("shopId");
CREATE INDEX "EventLog_shopId_createdAt_idx" ON "EventLog"("shopId", "createdAt");

ALTER TABLE "RuleSet" ADD CONSTRAINT "RuleSet_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventLog" ADD CONSTRAINT "EventLog_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
