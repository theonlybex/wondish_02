import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveOnboardingRedirect } from "./onboarding-gate";

// The dashboard gate has to serve two populations that look identical in the
// account row: restaurant staff who are not patients (must never be trapped in
// patient onboarding) and patients who also manage a restaurant (must still be
// asked to finish their profile). A Patient row is the discriminator — nothing
// creates one except the profile form itself.

describe("resolveOnboardingRedirect", () => {
  it("lets an onboarded account through untouched", () => {
    assert.equal(
      resolveOnboardingRedirect({ onboarded: true, isRestaurantStaff: true, hasPatientRow: false }),
      null
    );
  });

  it("sends a plain unonboarded patient to profile onboarding", () => {
    assert.equal(
      resolveOnboardingRedirect({ onboarded: false, isRestaurantStaff: false, hasPatientRow: false }),
      "/profile?onboarding=true"
    );
  });

  it("sends portal-only staff to their portal, never into patient onboarding", () => {
    assert.equal(
      resolveOnboardingRedirect({ onboarded: false, isRestaurantStaff: true, hasPatientRow: false }),
      "/restaurant"
    );
  });

  // The trap: staff who started patient onboarding used to be bounced to the
  // portal, where the back link is deliberately absent for exactly this
  // account shape — no route back, and /overview bounced them again.
  it("lets staff who started a patient profile finish it instead of bouncing them to the portal", () => {
    assert.equal(
      resolveOnboardingRedirect({ onboarded: false, isRestaurantStaff: true, hasPatientRow: true }),
      "/profile?onboarding=true"
    );
  });

  it("does not redirect an onboarded staff patient", () => {
    assert.equal(
      resolveOnboardingRedirect({ onboarded: true, isRestaurantStaff: true, hasPatientRow: true }),
      null
    );
  });
});
