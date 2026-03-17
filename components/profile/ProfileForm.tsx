"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";
import MultiSelectChips from "@/components/profile/MultiSelectChips";

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

  const [form, setForm] = useState({
    firstName: accountData.firstName ?? "",
    lastName: accountData.lastName ?? "",
    birthday: patient?.birthday
      ? new Date(patient.birthday as string).toISOString().slice(0, 10)
      : "",
    genderId: (patient?.genderId as string) ?? "",
    height: String(patient?.height ?? ""),
    heightUnit: (patient?.heightUnit as string) ?? "cm",
    weight: String(patient?.weight ?? ""),
    weightUnit: (patient?.weightUnit as string) ?? "kg",
    physicalActivityId: (patient?.physicalActivityId as string) ?? "",
    goalWeight: String(patient?.goalWeight ?? ""),
    weeklyGoal: String(patient?.weeklyGoal ?? ""),
  });

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
        window.location.href = "/meal-plan";
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
            label="Gender"
            value={form.genderId}
            onChange={(e) => setForm((f) => ({ ...f, genderId: e.target.value }))}
            options={refData.genders.map((g) => ({ value: g.id, label: g.name }))}
            placeholder="Select gender"
          />
        </div>
      </section>

      {/* Body Metrics */}
      <section>
        <h2 className="text-base font-semibold text-navy mb-4">Body Metrics</h2>
        <div className="grid sm:grid-cols-2 gap-4">
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
                ]}
                value={form.heightUnit}
                onChange={(e) => setForm((f) => ({ ...f, heightUnit: e.target.value }))}
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Input
              label="Weight"
              type="number"
              min="0"
              step="0.1"
              className="flex-1"
              value={form.weight}
              onChange={(e) => setForm((f) => ({ ...f, weight: e.target.value }))}
              placeholder="70"
            />
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-[#25293C]">Unit</label>
              <Select
                options={[
                  { value: "kg", label: "kg" },
                  { value: "lbs", label: "lbs" },
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
      </section>

      {/* Goals */}
      <section>
        <h2 className="text-base font-semibold text-navy mb-4">Goals</h2>
        <div className="grid sm:grid-cols-2 gap-4 mb-6">
          <Input
            label="Goal Weight (kg)"
            type="number"
            min="0"
            step="0.1"
            value={form.goalWeight}
            onChange={(e) => setForm((f) => ({ ...f, goalWeight: e.target.value }))}
            placeholder="65"
          />
          <Select
            label="Weekly Goal"
            value={form.weeklyGoal}
            onChange={(e) => setForm((f) => ({ ...f, weeklyGoal: e.target.value }))}
            options={[
              { value: "0.25", label: "Lose 0.25 kg/week" },
              { value: "0.5", label: "Lose 0.5 kg/week" },
              { value: "0.75", label: "Lose 0.75 kg/week" },
              { value: "1", label: "Lose 1 kg/week" },
              { value: "0", label: "Maintain weight" },
              { value: "-0.25", label: "Gain 0.25 kg/week" },
              { value: "-0.5", label: "Gain 0.5 kg/week" },
            ]}
            placeholder="Select weekly goal"
          />
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
            label="Food Preferences"
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
