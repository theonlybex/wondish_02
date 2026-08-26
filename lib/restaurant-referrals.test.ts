import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  referralFunnelState,
  conversionRate,
  formatConversionRate,
  isValidQrToken,
  QR_TOKEN_LENGTH,
} from "./restaurant-referrals";

// Phase 3 §5. Funnel state is DERIVED from the account, never stored — a
// stored copy would drift from the account it describes.
describe("referralFunnelState", () => {
  it("is signed_up before onboarding completes", () => {
    assert.equal(referralFunnelState({ onboardingComplete: false }), "signed_up");
  });

  it("is profile_complete once onboarding completes", () => {
    assert.equal(referralFunnelState({ onboardingComplete: true }), "profile_complete");
  });
});

// The pilot's headline number. Zero scans is "no data", NOT 0% — reporting a
// hard zero for a code nobody has scanned would read as a failing code.
describe("conversionRate", () => {
  it("is null when nothing has been scanned", () => {
    assert.equal(conversionRate(0, 0), null);
  });

  it("computes signups over scans", () => {
    assert.equal(conversionRate(10, 3), 0.3);
  });

  it("is 0 for scans that produced no signups", () => {
    assert.equal(conversionRate(10, 0), 0);
  });

  // Defensive: counters are incremented by separate code paths, so a signup
  // recorded without its scan must not render as 250%.
  it("clamps above 1 rather than reporting an impossible rate", () => {
    assert.equal(conversionRate(2, 5), 1);
  });

  it("treats negative counters as no data", () => {
    assert.equal(conversionRate(-1, 3), null);
  });
});

describe("formatConversionRate", () => {
  it("renders a dash when there is no data", () => {
    assert.equal(formatConversionRate(null), "—");
  });

  it("renders whole percents", () => {
    assert.equal(formatConversionRate(0.3), "30%");
  });

  it("rounds to the nearest percent", () => {
    assert.equal(formatConversionRate(0.336), "34%");
  });
});

// The token comes off a URL a stranger controls, so it is validated before it
// ever reaches a query.
describe("isValidQrToken", () => {
  it("accepts a well-formed token", () => {
    assert.equal(isValidQrToken("a".repeat(QR_TOKEN_LENGTH)), true);
  });

  it("rejects the wrong length", () => {
    assert.equal(isValidQrToken("abc"), false);
  });

  it("rejects non-alphanumeric characters", () => {
    assert.equal(isValidQrToken("../".padEnd(QR_TOKEN_LENGTH, "a")), false);
  });

  it("rejects non-strings", () => {
    assert.equal(isValidQrToken(null), false);
    assert.equal(isValidQrToken(123), false);
  });
});
