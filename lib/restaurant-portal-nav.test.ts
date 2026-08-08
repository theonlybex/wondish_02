import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { portalBackLink } from "./restaurant-portal-nav";

// Phase 6a — the portal's "back" affordance must never point at a route that
// bounces straight back (docs/restaurants/phase-6a-restaurant-admin-design.md
// §5.1). /restaurant redirects single-membership staff into their restaurant,
// so linking there is a no-op loop that only pollutes browser history.

describe("portalBackLink", () => {
  it("links to the switcher when there is more than one restaurant", () => {
    const link = portalBackLink({ membershipCount: 2, isSuper: false, onboardedPatient: false });
    assert.deepEqual(link, { href: "/restaurant", label: "Your restaurants" });
  });

  it("never links to the switcher with a single membership — it would redirect back", () => {
    const link = portalBackLink({ membershipCount: 1, isSuper: false, onboardedPatient: true });
    assert.notEqual(link?.href, "/restaurant");
  });

  it("sends a single-restaurant patient to the Wondish dashboard", () => {
    const link = portalBackLink({ membershipCount: 1, isSuper: false, onboardedPatient: true });
    assert.deepEqual(link, { href: "/overview", label: "Wondish dashboard" });
  });

  it("renders no back link for portal-only staff — the portal is their home", () => {
    const link = portalBackLink({ membershipCount: 1, isSuper: false, onboardedPatient: false });
    assert.equal(link, null);
  });

  it("sends ops back to the admin restaurant list, not the empty staff switcher", () => {
    const link = portalBackLink({ membershipCount: 0, isSuper: true, onboardedPatient: false });
    assert.deepEqual(link, { href: "/admin/restaurants", label: "Admin restaurants" });
  });

  it("prefers the switcher over admin when ops actually holds several memberships", () => {
    const link = portalBackLink({ membershipCount: 3, isSuper: true, onboardedPatient: true });
    assert.equal(link?.href, "/restaurant");
  });

  it("gives a zero-membership non-super account no dead link", () => {
    const link = portalBackLink({ membershipCount: 0, isSuper: false, onboardedPatient: false });
    assert.equal(link, null);
  });
});
