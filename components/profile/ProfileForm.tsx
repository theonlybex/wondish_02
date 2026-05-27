"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";
import MultiSelectChips from "@/components/profile/MultiSelectChips";
import {
  computeAllMetrics,
  feetInchesToCm,
  type Sex,
  type CaloricProfileInput,
  type CaloricProfile,
} from "@/lib/caloric-engine";

interface RefData {
  genders: { id: string; name: string }[];
  physicalActivities: { id: string; name: string; level: number }[];
  motivations: { id: string; name: string }[];
  healthConditions: { id: string; name: string }[];
  foodPreferences: { id: string; name: string }[];
  foodToAvoid: { id: string; name: string }[];
  foodAllergies: { id: string; name: string }[];
}

interface ProfileFormProps {
  initialData: Record<string, unknown> | null;
  refData: RefData;
  isOnboarding: boolean;
  accountData: { firstName: string; lastName: string; email: string };
}

export default function ProfileForm({
  initialData,
  refData,
  isOnboarding,
  accountData,
}: ProfileFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const patient = initialData as Record<string, unknown> | null;

  function normalizeGenderName(val: unknown): string {
    if (!val || typeof val !== "string") return "";
    const s = val.toLowerCase();
    if (s === "male") return "Male";
    if (s === "female") return "Female";
    return val;
  }

  const initialSex =
    normalizeGenderName(patient?.sexAtBirth) ||
    normalizeGenderName((patient?.gender as { name?: string } | null)?.name) ||
    "";

  const [form, setForm] = useState({
    firstName: accountData.firstName ?? "",
    lastName: accountData.lastName ?? "",
    birthday: patient?.birthday
      ? new Date(patient.birthday as string).toISOString().slice(0, 10)
      : "",
    sexAtBirth: initialSex,
    height: String(patient?.height ?? ""),
    heightUnit: (patient?.heightUnit as string) ?? "ftin",
    heightFt: String(patient?.heightFt ?? ""),
    heightIn: String(patient?.heightIn ?? ""),
    weight: String(patient?.weight ?? ""),
    weightUnit: (patient?.weightUnit as string) ?? "lbs",
    physicalActivityId: (patient?.physicalActivityId as string) ?? "",
    goalWeight: String(patient?.goalWeight ?? ""),
    goalWeightUnit: (patient?.goalWeightUnit as string) ?? "lbs",
    weeklyGoal: String(patient?.weeklyGoal ?? ""),
  });

  // Live caloric preview
  const liveProfile: CaloricProfile | null = useMemo(() => {
    const sex = form.sexAtBirth.toLowerCase() as Sex;
    if (sex !== "male" && sex !== "female") return null;
    if (!form.birthday || !form.height || !form.weight) return null;

    const actLevel = refData.physicalActivities.find(
      (a) => a.id === form.physicalActivityId
    )?.level ?? 1;

    let heightValue = parseFloat(form.height);
    let heightUnit: "cm" | "in" = form.heightUnit === "in" ? "in" : "cm";
    if (form.heightUnit === "ftin" && form.heightFt) {
      heightValue = feetInchesToCm(
        parseFloat(form.heightFt) || 0,
        parseFloat(form.heightIn) || 0
      );
      heightUnit = "cm";
    }

    if (isNaN(heightValue) || heightValue <= 0) return null;
    const weightValue = parseFloat(form.weight);
    if (isNaN(weightValue) || weightValue <= 0) return null;

    try {
      const input: CaloricProfileInput = {
        sex,
        birthday: new Date(form.birthday),
        heightValue,
        heightUnit,
        cbwValue: weightValue,
        cbwUnit: form.weightUnit === "lbs" ? "lbs" : "kg",
        activityLevel: actLevel,
        utbwValue: form.goalWeight ? parseFloat(form.goalWeight) : null,
        utbwUnit: form.goalWeightUnit === "lbs" ? "lbs" : "kg",
      };
      return computeAllMetrics(input);
    } catch {
      return null;
    }
  }, [
    form.sexAtBirth, form.birthday, form.height, form.heightUnit,
    form.heightFt, form.heightIn, form.weight, form.weightUnit,
    form.physicalActivityId, form.goalWeight, form.goalWeightUnit,
    refData.physicalActivities,
  ]);

  const [motivationIds, setMotivationIds] = useState<string[]>(
    (patient?.motivations as { motivationId: string }[])?.map((m) => m.motivationId) ?? []
  );
  const [healthConditionIds, setHealthConditionIds] = useState<string[]>(
    (patient?.healthConditions as { conditionId: string }[])?.map((m) => m.conditionId) ?? []
  );
  const [foodPreferenceIds, setFoodPreferenceIds] = useState<string[]>(
    (patient?.foodPreferences as { foodId: string }[])?.map((m) => m.foodId) ?? []
  );
  const [foodToAvoidIds, setFoodToAvoidIds] = useState<string[]>(
    (patient?.foodToAvoid as { foodId: string }[])?.map((m) => m.foodId) ?? []
  );
  const [foodAllergyIds, setFoodAllergyIds] = useState<string[]>(
    (patient?.foodAllergies as { foodId: string }[])?.map((m) => m.foodId) ?? []
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/patient/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          // If ft/in mode, convert to cm for the height field and pass original ft/in
          height:
            form.heightUnit === "ftin" && form.heightFt
              ? String(
                  feetInchesToCm(
                    parseFloat(form.heightFt) || 0,
                    parseFloat(form.heightIn) || 0
                  )
                )
              : form.height,
          // Keep heightUnit as "ftin" so the API knows the user's preference
          heightFt: form.heightUnit === "ftin" ? form.heightFt : null,
          heightIn: form.heightUnit === "ftin" ? form.heightIn : null,
          motivationIds,
          healthConditionIds,
          foodPreferenceIds,
          foodToAvoidIds,
          foodAllergyIds,
        }),
      });

      if (!res.ok) throw new Error("Failed to save profile");

      if (isOnboarding) {
        // Mark onboarding complete in Clerk metadata
        const onboardingRes = await fetch("/api/user/complete-onboarding", { method: "POST" });
        if (!onboardingRes.ok) throw new Error("Failed to complete onboarding");
        // Hard redirect so the browser fetches a fresh Clerk JWT with updated metadata
        window.location.href = "/prediction";
      } else {
        setSaved(true);
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-10 max-w-2xl">
      {isOnboarding && (
        <div className="bg-primary/10 border border-primary/20 text-primary rounded-xl px-4 py-3 text-sm font-medium">
          Welcome! Complete your profile to get a personalized meal plan.
        </div>
      )}

      {error && (
        <div className="bg-error/10 border border-error/20 text-error rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {saved && !isOnboarding && (
        <div className="bg-success/10 border border-success/20 text-success rounded-xl px-4 py-3 text-sm font-medium">
          Profile saved successfully.
        </div>
      )}

      {/* Personal Info */}
      <section>
        <h2 className="text-base font-semibold text-navy mb-4">Personal Information</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <Input
            label="First Name"
            value={form.firstName}
            onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
            required
          />
          <Input
            label="Last Name"
            value={form.lastName}
            onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
            required
          />
          <Input
            label="Birthday"
            type="date"
            value={form.birthday}
            onChange={(e) => setForm((f) => ({ ...f, birthday: e.target.value }))}
          />
          <Select
            label="Sex at Birth"
            value={form.sexAtBirth}
            onChange={(e) => setForm((f) => ({ ...f, sexAtBirth: e.target.value }))}
            options={refData.genders.map((g) => ({ value: g.name, label: g.name }))}
            placeholder="Select sex at birth"
          />
        </div>
      </section>

      {/* Body Metrics */}
      <section>
        <h2 className="text-base font-semibold text-navy mb-4">Body Metrics</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          {form.heightUnit === "ftin" ? (
            <div className="flex gap-2">
              <Input
                label="Height (ft)"
                type="number"
                min="0"
                step="1"
                className="flex-1"
                value={form.heightFt}
                onChange={(e) => setForm((f) => ({ ...f, heightFt: e.target.value }))}
                placeholder="5"
              />
              <Input
                label="(in)"
                type="number"
                min="0"
                max="11"
                step="1"
                className="flex-1"
                value={form.heightIn}
                onChange={(e) => setForm((f) => ({ ...f, heightIn: e.target.value }))}
                placeholder="9"
              />
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-[#25293C]">Unit</label>
                <Select
                  options={[
                    { value: "cm", label: "cm" },
                    { value: "in", label: "in" },
                    { value: "ftin", label: "ft/in" },
                  ]}
                  value={form.heightUnit}
                  onChange={(e) => setForm((f) => ({ ...f, heightUnit: e.target.value }))}
                />
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                label="Height"
                type="number"
                min="0"
                step="0.1"
                className="flex-1"
                value={form.height}
                onChange={(e) => setForm((f) => ({ ...f, height: e.target.value }))}
                placeholder="170"
              />
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-[#25293C]">Unit</label>
                <Select
                  options={[
                    { value: "cm", label: "cm" },
                    { value: "in", label: "in" },
                    { value: "ftin", label: "ft/in" },
                  ]}
                  value={form.heightUnit}
                  onChange={(e) => setForm((f) => ({ ...f, heightUnit: e.target.value }))}
                />
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <Input
              label="Weight"
              type="number"
              min="0"
              step="0.1"
              className="flex-1"
              value={form.weight}
              onChange={(e) => setForm((f) => ({ ...f, weight: e.target.value }))}
              placeholder="150"
            />
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-[#25293C]">Unit</label>
              <Select
                options={[
                  { value: "lbs", label: "lbs" },
                  { value: "kg", label: "kg" },
                ]}
                value={form.weightUnit}
                onChange={(e) => setForm((f) => ({ ...f, weightUnit: e.target.value }))}
              />
            </div>
          </div>

          <Select
            label="Physical Activity"
            value={form.physicalActivityId}
            onChange={(e) => setForm((f) => ({ ...f, physicalActivityId: e.target.value }))}
            options={refData.physicalActivities.map((a) => ({
              value: a.id,
              label: a.name,
            }))}
            placeholder="Select activity level"
          />
        </div>

        {/* Live Caloric Summary */}
        {liveProfile && (
          <div className="mt-4 p-4 rounded-xl border border-primary/20 bg-primary/5">
            <p className="text-xs font-semibold text-primary uppercase tracking-wider mb-2">
              Estimated Caloric Summary
            </p>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <span className="text-[#9EA8A0] text-xs">BMI</span>
                <p className="font-bold text-[#25293C]">
                  {liveProfile.cbmi.toFixed(1)}{" "}
                  <span className="text-xs font-normal capitalize text-[#9EA8A0]">
                    ({liveProfile.cbmiClass})
                  </span>
                </p>
              </div>
              <div>
                <span className="text-[#9EA8A0] text-xs">Daily Calories</span>
                <p className="font-bold text-primary">
                  {Math.round(liveProfile.dailyCalories)} kcal
                </p>
              </div>
              <div>
                <span className="text-[#9EA8A0] text-xs">Target Weight</span>
                <p className="font-bold text-[#25293C]">
                  {liveProfile.tbwKg.toFixed(1)} kg
                </p>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Goals */}
      <section>
        <h2 className="text-base font-semibold text-navy mb-4">Goals</h2>
        <div className="grid sm:grid-cols-2 gap-4 mb-6">
          <div className="flex gap-2">
            <Input
              label="Goal Weight"
              type="number"
              min="0"
              step="0.1"
              className="flex-1"
              value={form.goalWeight}
              onChange={(e) => setForm((f) => ({ ...f, goalWeight: e.target.value }))}
              placeholder="65"
            />
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-[#25293C]">Unit</label>
              <Select
                options={[
                  { value: "kg", label: "kg" },
                  { value: "lbs", label: "lbs" },
                ]}
                value={form.goalWeightUnit}
                onChange={(e) => setForm((f) => ({ ...f, goalWeightUnit: e.target.value }))}
              />
            </div>
          </div>
        </div>
        <MultiSelectChips
          label="Motivations"
          options={refData.motivations}
          selected={motivationIds}
          onChange={setMotivationIds}
        />
      </section>

      {/* Dietary Preferences */}
      <section>
        <h2 className="text-base font-semibold text-navy mb-4">Dietary Preferences</h2>
        <div className="space-y-6">
          <MultiSelectChips
            label="Diets"
            options={refData.foodPreferences}
            selected={foodPreferenceIds}
            onChange={setFoodPreferenceIds}
          />
          <MultiSelectChips
            label="Foods to Avoid"
            options={refData.foodToAvoid}
            selected={foodToAvoidIds}
            onChange={setFoodToAvoidIds}
          />
          <MultiSelectChips
            label="Food Allergies"
            options={refData.foodAllergies}
            selected={foodAllergyIds}
            onChange={setFoodAllergyIds}
          />
          <MultiSelectChips
            label="Health Conditions"
            options={refData.healthConditions}
            selected={healthConditionIds}
            onChange={setHealthConditionIds}
          />
        </div>
      </section>

      <div className="pt-2">
        <Button type="submit" size="lg" loading={loading}>
          {isOnboarding ? "Save & Continue to Meal Plan →" : "Save Profile"}
        </Button>
      </div>
    </form>
  );
}
