"use client";

import { useEffect, useRef, useState } from "react";
import * as Sentry from "@sentry/nextjs";
import Button from "@/components/ui/Button";
import { FEEDBACK_TEXT_MAX, FEEDBACK_TEXT_MIN, FEEDBACK_MAX_IMAGE_BYTES, FEEDBACK_MAX_IMAGE_MB } from "@/lib/feedback/validate";
import { USER_STATUS_LABEL, type UserStatus } from "@/lib/feedback/status";
import { LAST_PAGE_KEY } from "@/lib/profile-exit";

const AREAS: { value: string; label: string }[] = [
  { value: "meal-plan", label: "Meal plan" },
  { value: "ingredients", label: "Ingredients / What to buy" },
  { value: "clara", label: "Clara" },
  { value: "journal", label: "Journal" },
  { value: "trials", label: "Trials" },
  { value: "profile", label: "Profile" },
  { value: "other", label: "Something else" },
];
// The page the user came from (recorded by the sidebar) pre-selects an area.
const AREA_BY_PATH: [RegExp, string][] = [
  [/^\/meal-plan/, "meal-plan"], [/^\/pantry|^\/what-to-buy/, "ingredients"], [/^\/clara|^\/ai|^\/dish-checker/, "clara"],
  [/^\/journal/, "journal"], [/^\/trials/, "trials"], [/^\/profile/, "profile"],
];
const BADGE: Record<UserStatus, { bg: string; fg: string }> = {
  PENDING: { bg: "#F5F1DD", fg: "#5F5A5A" },
  NEW: { bg: "#F5F1DD", fg: "#5F5A5A" },
  INVESTIGATING: { bg: "#FDF0E3", fg: "#8A4B12" },
  FIXED: { bg: "#E6F3EC", fg: "#1F6B45" },
  WONT_FIX: { bg: "#F0EFF5", fg: "#4A4646" },
};
type Report = { id: string; text: string; createdAt: string; status: UserStatus };

export default function FeedbackForm() {
  const [text, setText] = useState("");
  const [area, setArea] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [sent, setSent] = useState(false);
  const [reports, setReports] = useState<Report[] | null>(null);
  const [listError, setListError] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const loadReports = async () => {
    // The list is a convenience; the form works without it.
    try {
      const res = await fetch("/api/feedback");
      if (!res.ok) throw new Error(String(res.status));
      setReports((await res.json()).reports);
      setListError(false);
    } catch {
      setListError(true);
    }
  };
  useEffect(() => {
    let prev = "";
    try { prev = sessionStorage.getItem(LAST_PAGE_KEY) ?? ""; } catch { /* private mode */ }
    setFrom(prev);
    const hit = AREA_BY_PATH.find(([re]) => re.test(prev));
    if (hit) setArea(hit[1]);
    void loadReports();
  }, []);

  const pickFile = (f: File | null) => {
    setError(null);
    if (f && f.size > FEEDBACK_MAX_IMAGE_BYTES) {
      setError({ field: "screenshot", message: `Screenshots can be up to ${FEEDBACK_MAX_IMAGE_MB} MB.` });
      return;
    }
    setFile(f);
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    setError(null);
    setSent(false);
    if (text.trim().length < FEEDBACK_TEXT_MIN) {
      setError({ field: "text", message: `Please add a little more detail (at least ${FEEDBACK_TEXT_MIN} characters).` });
      textRef.current?.focus();
      return;
    }
    setSending(true);
    try {
      const body = new FormData();
      body.append("text", text);
      if (area) body.append("area", area);
      if (from) body.append("from", from);
      body.append("viewport", `${window.innerWidth}x${window.innerHeight}`);
      try {
        const id = Sentry.lastEventId();
        if (id) body.append("sentryEventId", id);
      } catch { /* Sentry not initialised */ }
      if (file) body.append("screenshot", file);
      const res = await fetch("/api/feedback", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      // The platform's own body-size refusal is not JSON — say what to do.
      if (res.status === 413) {
        setError({ field: "screenshot", message: `That screenshot is too large — please attach one under ${FEEDBACK_MAX_IMAGE_MB} MB.` });
        return;
      }
      if (!res.ok) {
        setError({ field: data.field, message: data.error ?? "Could not send. Please try again." });
        if (data.field === "text") textRef.current?.focus();
        return;
      }
      setText("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      setSent(true);
      void loadReports();
    } catch {
      setError({ message: "Could not send — check your connection and try again." });
    } finally {
      setSending(false);
    }
  };

  const tooShort = text.trim().length < FEEDBACK_TEXT_MIN;
  return (
    <div className="space-y-8">
      <form onSubmit={send} noValidate className="bg-white rounded-2xl border border-[#EAE4CA] p-4 sm:p-6 space-y-5">
        <div>
          <label htmlFor="fb-text" className="block text-sm font-medium text-[#1E1A1A] mb-1.5">What went wrong?</label>
          <textarea
            id="fb-text"
            ref={textRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            maxLength={FEEDBACK_TEXT_MAX}
            placeholder="e.g. My shopping list shows bacon although I'm vegetarian."
            aria-describedby="fb-text-help"
            aria-invalid={error?.field === "text"}
            className="w-full px-4 py-3 rounded-xl border-2 border-[#F5F1DD] bg-white text-base sm:text-sm text-[#1E1A1A] outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition-all resize-y"
          />
          <p id="fb-text-help" className="text-xs mt-1.5 tabular-nums" style={{ color: "#6B6767" }}>
            What you did and what happened. {text.length}/{FEEDBACK_TEXT_MAX}
          </p>
          {error?.field === "text" && <p className="text-error text-xs mt-1.5" role="alert">{error.message}</p>}
        </div>

        <fieldset>
          <legend className="text-sm font-medium text-[#1E1A1A] mb-2">Where were you? <span className="font-normal" style={{ color: "#6B6767" }}>(optional)</span></legend>
          <div className="flex flex-wrap gap-2">
            {AREAS.map((a) => {
              const on = area === a.value;
              return (
                <button
                  key={a.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setArea(on ? null : a.value)}
                  className={`min-h-[44px] px-4 py-2 rounded-full text-sm font-medium transition-colors ${on ? "bg-primary text-white shadow-sm shadow-primary/30" : "bg-[#F3F2FF] text-[#4A4646] hover:bg-primary/10 hover:text-primary"}`}
                >
                  {a.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div>
          <p className="text-sm font-medium text-[#1E1A1A] mb-2">Screenshot <span className="font-normal" style={{ color: "#6B6767" }}>(optional)</span></p>
          <input
            ref={fileRef}
            id="fb-shot"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
          {file ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-[#1E1A1A] truncate min-w-0" title={file.name}>{file.name}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ""; }}>
                Remove
              </Button>
            </div>
          ) : (
            <label htmlFor="fb-shot" className="inline-flex items-center min-h-[44px] px-4 py-2 rounded-xl border-2 border-dashed border-[#EAE4CA] text-sm font-medium text-[#4A4646] cursor-pointer hover:border-primary hover:text-primary focus-within:ring-2 focus-within:ring-primary/30">
              Attach an image (PNG, JPEG or WebP, up to {FEEDBACK_MAX_IMAGE_MB} MB)
            </label>
          )}
          {error?.field === "screenshot" && <p className="text-error text-xs mt-1.5" role="alert">{error.message}</p>}
        </div>

        {error && !error.field && <p className="text-error text-sm" role="alert">{error.message}</p>}
        <p role="status" aria-live="polite" className="text-sm font-medium" style={{ color: "#1F6B45" }}>
          {sent ? "Thanks — we've got it. You'll see its status below." : ""}
        </p>
        <Button type="submit" loading={sending} disabled={tooShort}>Send</Button>
      </form>

      <section aria-labelledby="fb-mine">
        <h2 id="fb-mine" className="text-base font-semibold text-[#1E1A1A] mb-3">Your reports</h2>
        {listError && reports === null ? (
          <p className="text-sm" style={{ color: "#6B6767" }}>Couldn&apos;t load your reports right now — your new report still sends.</p>
        ) : reports === null ? (
          <p className="text-sm" style={{ color: "#6B6767" }}>Loading…</p>
        ) : reports.length === 0 ? (
          <p className="text-sm" style={{ color: "#6B6767" }}>No reports yet.</p>
        ) : (
          <ul className="space-y-2">
            {reports.map((r) => {
              const firstLine = r.text.split("\n")[0];
              const b = BADGE[r.status] ?? BADGE.NEW;
              return (
                <li key={r.id} className="bg-white rounded-xl border border-[#EAE4CA] px-4 py-3 flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-[#1E1A1A] truncate" title={r.text}>{firstLine}</p>
                    <p className="text-xs mt-0.5" style={{ color: "#6B6767" }}>
                      {new Date(r.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] font-semibold px-2 py-1 rounded-full" style={{ background: b.bg, color: b.fg }}>
                    {USER_STATUS_LABEL[r.status] ?? "New"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
