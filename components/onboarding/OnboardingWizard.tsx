"use client";

import { useMemo, useState } from "react";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";
import MultiSelectChips from "@/components/profile/MultiSelectChips";
import {
  computeAllMetrics,
  feetInchesToCm,
  type Sex,
  type CaloricProfile,
  type CaloricProfileInput,
} from "@/lib/caloric-engine";
import { kgToLbs, toKg } from "@/lib/prediction-data";

interface RefData {
  genders: { id: string; name: string }[];
  physicalActivities: { id: string; name: string; level: number }[];
  motivations: { id: string; name: string }[];
  healthConditions: { id: string; name: string }[];
  foodPreferences: { id: string; name: string }[];
  foodToAvoid: { id: string; name: string }[];
  foodAllergies: { id: string; name: string }[];
}

interface OnboardingWizardProps {
  refData: RefData;
  accountData: { firstName: string; lastName: string; email: string };
}

// One question per screen. Optional steps carry `skippable`; required steps
// gate the Continue button through `validate` so an incomplete profile can
// never reach the dashboard's onboarding gate and silently bounce back here.
type StepId =
  | "welcome"
  | "motivations"
  | "about"
  | "body"
  | "activity"
  | "reveal"
  | "safety"
  | "preferences"
  | "goal";

const STEPS: { id: StepId; skippable: boolean }[] = [
  { id: "welcome", skippable: false },
  { id: "motivations", skippable: true },
  { id: "about", skippable: false },
  { id: "body", skippable: false },
  { id: "activity", skippable: false },
  { id: "reveal", skippable: false },
  { id: "safety", skippable: true },
  { id: "preferences", skippable: true },
  { id: "goal", skippable: true },
];

export default function OnboardingWizard({ refData, accountData }: OnboardingWizardProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState("");
  const [saving, setSaving] = useState(false);

  const [firstName, setFirstName] = useState(accountData.firstName ?? "");
  const [lastName, setLastName] = useState(accountData.lastName ?? "");
  const [sexAtBirth, setSexAtBirth] = useState("");
  const [birthday, setBirthday] = useState("");
  const [heightUnit, setHeightUnit] = useState<"ftin" | "cm">("ftin");
  const [heightFt, setHeightFt] = useState("");
  const [heightIn, setHeightIn] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [weightUnit, setWeightUnit] = useState<"lbs" | "kg">("lbs");
  const [weight, setWeight] = useState("");
  const [physicalActivityId, setPhysicalActivityId] = useState("");
  const [goalWeight, setGoalWeight] = useState("");

  const [motivationIds, setMotivationIds] = useState<string[]>([]);
  const [foodAllergyIds, setFoodAllergyIds] = useState<string[]>([]);
  const [foodToAvoidIds, setFoodToAvoidIds] = useState<string[]>([]);
  const [foodPreferenceIds, setFoodPreferenceIds] = useState<string[]>([]);
  const [healthConditionIds, setHealthConditionIds] = useState<string[]>([]);

  const step = STEPS[stepIndex];
  const progress = Math.round((stepIndex / (STEPS.length - 1)) * 100);

  const heightCmValue = (): number => {
    if (heightUnit === "cm") return parseFloat(heightCm) || 0;
    return feetInchesToCm(parseFloat(heightFt) || 0, parseFloat(heightIn) || 0);
  };

  // Weight is stored in lbs everywhere downstream (mealPlanWeight and its
  // readers assume lbs) — a kg entry is converted at the boundary, never saved
  // with weightUnit "kg".
  const weightLbs = (): number => {
    const w = parseFloat(weight);
    if (!Number.isFinite(w) || w <= 0) return 0;
    return weightUnit === "kg" ? kgToLbs(w) : w;
  };
  const goalWeightLbs = (): number | null => {
    const g = parseFloat(goalWeight);
    if (!Number.isFinite(g) || g <= 0) return null;
    return weightUnit === "kg" ? kgToLbs(g) : g;
  };

  const liveProfile: CaloricProfile | null = useMemo(() => {
    const sex = sexAtBirth.toLowerCase() as Sex;
    if (sex !== "male" && sex !== "female") return null;
    if (!birthday) return null;
    const h = heightCmValue();
    const w = weightLbs();
    if (h <= 0 || w <= 0) return null;
    try {
      const input: CaloricProfileInput = {
        sex,
        birthday: new Date(birthday),
        heightValue: h,
        heightUnit: "cm",
        cbwValue: w,
        cbwUnit: "lbs",
        activityLevel:
          refData.physicalActivities.find((a) => a.id === physicalActivityId)?.level ?? 1,
        utbwValue: goalWeightLbs(),
        utbwUnit: "lbs",
      };
      return computeAllMetrics(input);
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    sexAtBirth, birthday, heightUnit, heightFt, heightIn, heightCm,
    weightUnit, weight, physicalActivityId, goalWeight, refData.physicalActivities,
  ]);

  const validateStep = (): Record<string, string> => {
    const errs: Record<string, string> = {};
    if (step.id === "about") {
      if (!firstName.trim()) errs.firstName = "Please enter your first name.";
      if (!lastName.trim()) errs.lastName = "Please enter your last name.";
      if (!sexAtBirth) errs.sexAtBirth = "Needed to calculate your metabolism.";
      if (!birthday) {
        errs.birthday = "Needed to calculate your metabolism.";
      } else {
        const age = (Date.now() - new Date(birthday).getTime()) / (365.25 * 86400000);
        if (Number.isNaN(age) || age < 13 || age > 120) {
          errs.birthday = "Please enter a valid birthday (age 13–120).";
        }
      }
    }
    if (step.id === "body") {
      if (heightCmValue() <= 0 || heightCmValue() > 300)
        errs.height = "Please enter your height.";
      if (weightLbs() <= 0 || weightLbs() > 1500)
        errs.weight = "Please enter your weight.";
    }
    if (step.id === "activity") {
      if (!physicalActivityId) errs.activity = "Pick the closest match — you can change it later.";
    }
    if (step.id === "goal" && goalWeight !== "") {
      const g = goalWeightLbs();
      if (g === null || g < 50 || g > 1000)
        errs.goalWeight = `Goal weight must be between ${
          weightUnit === "kg" ? "23 and 454 kg" : "50 and 1000 lbs"
        }.`;
    }
    return errs;
  };

  const next = () => {
    const errs = validateStep();
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;
    if (stepIndex === STEPS.length - 1) {
      void submit();
    } else {
      setStepIndex((i) => i + 1);
    }
  };

  const skip = () => {
    setFieldErrors({});
    if (step.id === "motivations") setMotivationIds([]);
    if (step.id === "safety") {
      setFoodAllergyIds([]);
      setFoodToAvoidIds([]);
    }
    if (step.id === "preferences") {
      setFoodPreferenceIds([]);
      setHealthConditionIds([]);
    }
    if (step.id === "goal") {
      setGoalWeight("");
      void submit();
      return;
    }
    setStepIndex((i) => i + 1);
  };

  const back = () => {
    setFieldErrors({});
    setSubmitError("");
    if (stepIndex > 0) setStepIndex((i) => i - 1);
  };

  const submit = async () => {
    setSaving(true);
    setSubmitError("");
    try {
      const res = await fetch("/api/patient/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName,
          lastName,
          birthday,
          sexAtBirth,
          height: String(heightCmValue()),
          heightUnit,
          heightFt: heightUnit === "ftin" ? heightFt : null,
          heightIn: heightUnit === "ftin" ? heightIn : null,
          weight: String(weightLbs()),
          weightUnit: "lbs",
          physicalActivityId,
          goalWeight: goalWeightLbs() != null ? String(goalWeightLbs()) : "",
          goalWeightUnit: "lbs",
          weeklyGoal: "",
          motivationIds,
          healthConditionIds,
          foodPreferenceIds,
          foodToAvoidIds,
          foodAllergyIds,
        }),
      });
      if (!res.ok) {
        // Surface the API's own message (422 field texts, 409 email conflict)
        // instead of a generic failure.
        let msg = "Something went wrong saving your profile. Please try again.";
        try {
          const data = await res.json();
          msg = data.message ?? data.error ?? msg;
        } catch {
          /* non-JSON error body — keep the generic message */
        }
        setSubmitError(msg);
        return;
      }
      // Hard navigation so the dashboard layout re-runs its onboarding gate
      // against fresh data. Next stop: "what's in your fridge?" — the pantry
      // step sits between the profile and the meal plan.
      window.location.href = "/pantry?onboarding=1";
    } catch {
      setSubmitError("Network error — nothing was lost. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const unitToggle = (
    active: string,
    options: { value: string; label: string }[],
    onPick: (v: string) => void
  ) => (
    <div className="inline-flex rounded-xl border border-[#EAE4CA] overflow-hidden">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onPick(o.value)}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            active === o.value ? "bg-primary text-white" : "bg-white text-[#848181] hover:text-primary"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="max-w-lg mx-auto">
      <style>{`
        @keyframes ow-rise {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .ow { animation: ow-rise 0.45s cubic-bezier(0.22, 1, 0.36, 1) both; }
      `}</style>

      {/* Progress + back */}
      <div className="flex items-center gap-4 mb-8">
        <button
          type="button"
          onClick={back}
          disabled={stepIndex === 0 || saving}
          aria-label="Back"
          className="w-9 h-9 rounded-full flex items-center justify-center border border-[#EAE4CA] bg-white text-[#848181] hover:text-primary disabled:opacity-30 transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div
          className="flex-1 h-1.5 rounded-full overflow-hidden"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          style={{ background: "#F5F1DD" }}
        >
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${Math.max(progress, 4)}%`, background: "linear-gradient(90deg, #812549, #B75E78)" }}
          />
        </div>
        <span className="text-xs tabular-nums font-medium" style={{ color: "#ABA6A6" }}>
          {stepIndex + 1}/{STEPS.length}
        </span>
      </div>

      <div key={step.id} className="ow bg-white rounded-2xl p-6 sm:p-8"
        style={{ boxShadow: "0 1px 3px rgba(30,26,26,0.07), 0 0 0 1px rgba(30,26,26,0.04)" }}
      >
        {step.id === "welcome" && (
          <div className="text-center py-4">
            <p className="text-[9px] tracking-[0.28em] uppercase font-mono mb-3" style={{ color: "#B75E78" }}>
              Welcome
            </p>
            <h1 className="text-2xl font-bold text-[#1E1A1A] mb-3">
              Let&apos;s build your plan{firstName ? `, ${firstName}` : ""}
            </h1>
            <p className="text-sm leading-relaxed max-w-xs mx-auto" style={{ color: "#848181" }}>
              A few quick questions so your meal plan matches your body, your goals, and your
              allergies. Takes about two minutes.
            </p>
          </div>
        )}

        {step.id === "motivations" && (
          <div>
            <h2 className="text-xl font-bold text-[#1E1A1A] mb-1">What brings you to Wondish?</h2>
            <p className="text-sm mb-6" style={{ color: "#848181" }}>
              Pick as many as you like — we&apos;ll tune your plan around them.
            </p>
            <MultiSelectChips
              label=""
              options={refData.motivations}
              selected={motivationIds}
              onChange={setMotivationIds}
            />
          </div>
        )}

        {step.id === "about" && (
          <div>
            <h2 className="text-xl font-bold text-[#1E1A1A] mb-1">About you</h2>
            <p className="text-sm mb-6" style={{ color: "#848181" }}>
              We use these only to calculate your metabolism — never for anything else.
            </p>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="First name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  error={fieldErrors.firstName}
                  autoComplete="given-name"
                />
                <Input
                  label="Last name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  error={fieldErrors.lastName}
                  autoComplete="family-name"
                />
              </div>
              <Select
                label="Sex at birth"
                value={sexAtBirth}
                onChange={(e) => setSexAtBirth(e.target.value)}
                options={refData.genders.map((g) => ({ value: g.name, label: g.name }))}
                placeholder="Select"
                error={fieldErrors.sexAtBirth}
              />
              <Input
                label="Birthday"
                type="date"
                value={birthday}
                onChange={(e) => setBirthday(e.target.value)}
                error={fieldErrors.birthday}
              />
            </div>
          </div>
        )}

        {step.id === "body" && (
          <div>
            <h2 className="text-xl font-bold text-[#1E1A1A] mb-1">Your body</h2>
            <p className="text-sm mb-6" style={{ color: "#848181" }}>
              These set your daily calorie target. You can update them anytime.
            </p>
            <div className="space-y-5">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium text-[#1E1A1A]">Height</span>
                  {unitToggle(
                    heightUnit,
                    [
                      { value: "ftin", label: "ft/in" },
                      { value: "cm", label: "cm" },
                    ],
                    (v) => setHeightUnit(v as "ftin" | "cm")
                  )}
                </div>
                {heightUnit === "ftin" ? (
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      type="number" min="0" max="9" step="1" placeholder="5"
                      value={heightFt}
                      onChange={(e) => setHeightFt(e.target.value)}
                      aria-label="Height in feet"
                    />
                    <Input
                      type="number" min="0" max="11" step="1" placeholder="9"
                      value={heightIn}
                      onChange={(e) => setHeightIn(e.target.value)}
                      aria-label="Additional inches"
                    />
                  </div>
                ) : (
                  <Input
                    type="number" min="0" max="300" step="0.1" placeholder="170"
                    value={heightCm}
                    onChange={(e) => setHeightCm(e.target.value)}
                    aria-label="Height in centimeters"
                  />
                )}
                {fieldErrors.height && <p className="text-error text-xs mt-1.5">{fieldErrors.height}</p>}
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium text-[#1E1A1A]">Weight</span>
                  {unitToggle(
                    weightUnit,
                    [
                      { value: "lbs", label: "lbs" },
                      { value: "kg", label: "kg" },
                    ],
                    (v) => setWeightUnit(v as "lbs" | "kg")
                  )}
                </div>
                <Input
                  type="number" min="0" step="0.1"
                  placeholder={weightUnit === "kg" ? "68" : "150"}
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  error={fieldErrors.weight}
                  aria-label={`Weight in ${weightUnit === "kg" ? "kilograms" : "pounds"}`}
                />
              </div>
            </div>
          </div>
        )}

        {step.id === "activity" && (
          <div>
            <h2 className="text-xl font-bold text-[#1E1A1A] mb-1">How active are you?</h2>
            <p className="text-sm mb-6" style={{ color: "#848181" }}>
              Your typical week — pick the closest match.
            </p>
            <div className="space-y-2.5" role="radiogroup" aria-label="Physical activity level">
              {refData.physicalActivities.map((a) => {
                const active = physicalActivityId === a.id;
                return (
                  <button
                    key={a.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setPhysicalActivityId(a.id)}
                    className={`w-full text-left px-4 py-3.5 rounded-xl border text-sm font-medium transition-all ${
                      active
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-[#EAE4CA] bg-white text-[#1E1A1A] hover:border-primary/40"
                    }`}
                  >
                    {a.name}
                  </button>
                );
              })}
            </div>
            {fieldErrors.activity && <p className="text-error text-xs mt-2">{fieldErrors.activity}</p>}
          </div>
        )}

        {step.id === "reveal" && (
          <div className="text-center py-2">
            <p className="text-[9px] tracking-[0.28em] uppercase font-mono mb-4" style={{ color: "#B75E78" }}>
              Your numbers
            </p>
            {liveProfile ? (
              <>
                <p className="text-sm mb-1" style={{ color: "#848181" }}>Your body burns about</p>
                <p className="font-black tabular-nums leading-none text-primary" style={{ fontSize: "3rem" }}>
                  {Math.round(liveProfile.dailyCalories).toLocaleString()}
                </p>
                <p className="text-sm font-semibold text-[#1E1A1A] mt-1 mb-8">calories a day</p>
                <div className="grid grid-cols-2 gap-3 text-left">
                  <div className="rounded-xl px-4 py-3" style={{ background: "#F9F7ED" }}>
                    <p className="text-[9px] tracking-[0.22em] uppercase font-bold mb-1" style={{ color: "#ABA6A6" }}>BMI</p>
                    <p className="font-bold text-[#1E1A1A]">
                      {liveProfile.cbmi.toFixed(1)}{" "}
                      <span className="text-xs font-normal capitalize" style={{ color: "#848181" }}>
                        ({liveProfile.cbmiClass})
                      </span>
                    </p>
                  </div>
                  <div className="rounded-xl px-4 py-3" style={{ background: "#F9F7ED" }}>
                    <p className="text-[9px] tracking-[0.22em] uppercase font-bold mb-1" style={{ color: "#ABA6A6" }}>Healthy target</p>
                    <p className="font-bold text-[#1E1A1A]">
                      {weightUnit === "kg"
                        ? `${liveProfile.tbwKg.toFixed(1)} kg`
                        : `${kgToLbs(liveProfile.tbwKg).toFixed(0)} lbs`}
                    </p>
                  </div>
                </div>
                <p className="text-xs mt-6" style={{ color: "#ABA6A6" }}>
                  Your meal plan is built around this number.
                </p>
              </>
            ) : (
              <p className="text-sm py-8" style={{ color: "#848181" }}>
                We couldn&apos;t compute your summary from these answers — you can continue and
                fine-tune your profile later.
              </p>
            )}
          </div>
        )}

        {step.id === "safety" && (
          <div>
            <h2 className="text-xl font-bold text-[#1E1A1A] mb-1">Anything we should never serve you?</h2>
            <p className="text-sm mb-6" style={{ color: "#848181" }}>
              Allergies are strictly excluded from every plan, swap, and restaurant match.
            </p>
            <div className="space-y-6">
              <MultiSelectChips
                label="Food allergies"
                options={refData.foodAllergies}
                selected={foodAllergyIds}
                onChange={setFoodAllergyIds}
              />
              <MultiSelectChips
                label="Foods you'd rather avoid"
                options={refData.foodToAvoid}
                selected={foodToAvoidIds}
                onChange={setFoodToAvoidIds}
              />
            </div>
          </div>
        )}

        {step.id === "preferences" && (
          <div>
            <h2 className="text-xl font-bold text-[#1E1A1A] mb-1">Diet &amp; health</h2>
            <p className="text-sm mb-6" style={{ color: "#848181" }}>
              Optional — both refine what lands on your plate.
            </p>
            <div className="space-y-6">
              <MultiSelectChips
                label="Diets you follow"
                options={refData.foodPreferences}
                selected={foodPreferenceIds}
                onChange={setFoodPreferenceIds}
              />
              <MultiSelectChips
                label="Health conditions"
                options={refData.healthConditions}
                selected={healthConditionIds}
                onChange={setHealthConditionIds}
              />
            </div>
          </div>
        )}

        {step.id === "goal" && (
          <div>
            <h2 className="text-xl font-bold text-[#1E1A1A] mb-1">Got a goal weight?</h2>
            <p className="text-sm mb-6" style={{ color: "#848181" }}>
              Optional — if you set one, your plan paces you toward it safely.
            </p>
            <Input
              label={`Goal weight (${weightUnit})`}
              type="number" min="0" step="0.1"
              placeholder={weightUnit === "kg" ? "63" : "140"}
              value={goalWeight}
              onChange={(e) => setGoalWeight(e.target.value)}
              error={fieldErrors.goalWeight}
            />
            {liveProfile && goalWeightLbs() != null && (
              <p className="text-xs mt-3" style={{ color: "#848181" }}>
                From {Math.round(weightLbs())} lbs today toward {Math.round(goalWeightLbs()!)} lbs —
                your daily target adjusts gradually, never crash-dieting.
              </p>
            )}
            {submitError && (
              <div role="alert" className="bg-error/10 border border-error/20 text-error rounded-xl px-4 py-3 text-sm mt-5">
                {submitError}
              </div>
            )}
          </div>
        )}

        {/* Footer actions */}
        <div className="flex items-center gap-3 mt-8">
          <Button type="button" size="lg" loading={saving} onClick={next} className="flex-1">
            {step.id === "welcome"
              ? "Get started"
              : stepIndex === STEPS.length - 1
                ? "Save & continue →"
                : "Continue"}
          </Button>
          {step.skippable && !saving && (
            <button
              type="button"
              onClick={skip}
              className="px-4 py-3 text-sm font-medium rounded-xl transition-colors hover:bg-[#F5F1DD]"
              style={{ color: "#ABA6A6" }}
            >
              Skip
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
