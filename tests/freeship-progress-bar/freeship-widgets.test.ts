import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const progressScript = readAsset(
  "../../extensions/freeship-progress-bar/assets/freeship-progress.js",
);
const protectionScript = readAsset(
  "../../extensions/freeship-progress-bar/assets/freeship-protection.js",
);

describe("storefront cart widgets", () => {
  it("progress widget does not refresh from its own DOM mutations", () => {
    expect(progressScript).not.toContain("MutationObserver");
    expect(progressScript).not.toContain("watchDomChanges");
  });

  it("protection widget does not refresh from its own DOM mutations", () => {
    expect(protectionScript).not.toContain("MutationObserver");
    expect(protectionScript).not.toContain("watchDomChanges");
  });

  it("ignores stale cart refresh responses", () => {
    for (const script of [progressScript, protectionScript]) {
      expect(script).toContain("refreshSequence");
      expect(script).toContain("sequence !== refreshSequence");
    }
  });

  it("can mount cart-page widgets inside cart drawer summaries", () => {
    for (const script of [progressScript, protectionScript]) {
      expect(script).toContain(".cart-drawer__footer");
      expect(script).toContain('[aria-controls*="Cart"]');
      expect(script).toContain("!isCartPage() && !summaryTarget");
    }
  });
});

function readAsset(fileName: string) {
  return readFileSync(new URL(fileName, import.meta.url), "utf8");
}
