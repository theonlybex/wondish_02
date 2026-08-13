import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  groupDishesBySection,
  describeViolation,
  summarizeViolations,
  dishVerdictState,
} from "./restaurant-menu-view";

// Phase 2 web (docs/restaurants/phase-2.md). The menu is the surface that makes
// allergy-relevant claims about third-party food, so the presentation rules are
// pinned here rather than left to JSX: a failing dish must always carry a
// readable REASON (never colour/graying alone — WCAG "don't convey by colour"),
// and "no profile" must never be rendered as "this dish fits you".

describe("dishVerdictState", () => {
  it("is 'unknown' when there is no verdict (signed out / no profile)", () => {
    assert.equal(dishVerdictState(null), "unknown");
  });

  it("is 'fits' only on a passing verdict", () => {
    assert.equal(dishVerdictState({ passed: true, caution: false, violations: [] }), "fits");
  });

  it("is 'doesntFit' when there are violations", () => {
    assert.equal(
      dishVerdictState({
        passed: false,
        caution: false,
        violations: [{ ingredient: "peanuts", term: "peanut", source: "allergy" }],
      }),
      "doesntFit"
    );
  });

  // Defensive: a not-passed verdict with an empty violations list must not
  // render as "fits". Positive evidence only.
  it("never reports 'fits' for a failed verdict with no listed violations", () => {
    assert.equal(dishVerdictState({ passed: false, caution: false, violations: [] }), "doesntFit");
  });
});

describe("describeViolation", () => {
  it("names the ingredient and the allergy source", () => {
    assert.equal(
      describeViolation({ ingredient: "peanuts", term: "peanut", source: "allergy" }),
      "Contains peanuts — allergy"
    );
  });

  it("labels a food-to-avoid violation", () => {
    assert.equal(
      describeViolation({ ingredient: "shellfish", term: "shrimp", source: "avoid" }),
      "Contains shellfish — you avoid this"
    );
  });

  it("labels a health-condition violation", () => {
    assert.equal(
      describeViolation({ ingredient: "sugar", term: "sugar", source: "condition" }),
      "Contains sugar — health condition"
    );
  });

  it("labels preference and motivation violations", () => {
    assert.equal(
      describeViolation({ ingredient: "beef", term: "beef", source: "preference" }),
      "Contains beef — food preference"
    );
    assert.equal(
      describeViolation({ ingredient: "butter", term: "butter", source: "motivation" }),
      "Contains butter — your goal"
    );
  });
});

describe("summarizeViolations", () => {
  it("returns null when nothing is violated", () => {
    assert.equal(summarizeViolations([]), null);
  });

  it("uses the single violation verbatim", () => {
    assert.equal(
      summarizeViolations([{ ingredient: "peanuts", term: "peanut", source: "allergy" }]),
      "Contains peanuts — allergy"
    );
  });

  // Allergies are the highest-stakes reason, so they lead the badge even when
  // a milder violation was found first.
  it("leads with the allergy when several sources fire", () => {
    const out = summarizeViolations([
      { ingredient: "beef", term: "beef", source: "preference" },
      { ingredient: "peanuts", term: "peanut", source: "allergy" },
    ]);
    assert.match(out!, /^Contains peanuts — allergy/);
  });

  it("counts the rest rather than listing everything", () => {
    const out = summarizeViolations([
      { ingredient: "peanuts", term: "peanut", source: "allergy" },
      { ingredient: "beef", term: "beef", source: "preference" },
      { ingredient: "butter", term: "butter", source: "motivation" },
    ]);
    assert.equal(out, "Contains peanuts — allergy +2 more");
  });
});

describe("groupDishesBySection", () => {
  const dish = (id: string, section: string, sortOrder: number) =>
    ({ id, section, sortOrder }) as any;

  it("groups by section preserving first-seen section order", () => {
    const out = groupDishesBySection([
      dish("d1", "Mains", 0),
      dish("d2", "Starters", 0),
      dish("d3", "Mains", 1),
    ]);
    assert.deepEqual(out.map((s) => s.section), ["Mains", "Starters"]);
    assert.deepEqual(out[0].dishes.map((d: any) => d.id), ["d1", "d3"]);
  });

  it("orders dishes within a section by sortOrder", () => {
    const out = groupDishesBySection([dish("b", "Mains", 5), dish("a", "Mains", 1)]);
    assert.deepEqual(out[0].dishes.map((d: any) => d.id), ["a", "b"]);
  });

  it("handles an empty menu", () => {
    assert.deepEqual(groupDishesBySection([]), []);
  });

  it("keeps a blank section under a neutral heading rather than dropping it", () => {
    const out = groupDishesBySection([dish("d1", "", 0)]);
    assert.equal(out.length, 1);
    assert.equal(out[0].section, "Menu");
  });
});
