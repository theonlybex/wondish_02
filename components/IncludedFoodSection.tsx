"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import Modal from "./ui/Modal";
import Input from "./ui/Input";

type Errors = Partial<Record<"name" | "zip" | "email" | "consent", string>>;

export default function IncludedFoodSection() {
  const t = useTranslations("includedFood");

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [zip, setZip] = useState("");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  function validate(): Errors {
    const next: Errors = {};
    if (!name.trim()) next.name = t("errorRequired");
    if (!zip.trim()) next.zip = t("errorRequired");
    if (!email.trim() || !/^\S+@\S+\.\S+$/.test(email)) next.email = t("errorEmail");
    if (!consent) next.consent = t("errorConsent");
    return next;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setLoading(true);
    // TODO: connect food-availability form to backend
    await new Promise((resolve) => setTimeout(resolve, 600));
    setLoading(false);
    setSubmitted(true);
  }

  function handleClose() {
    setOpen(false);
    setErrors({});
    setSubmitted(false);
  }

  return (
    <div
      className="reveal max-w-[880px] mx-auto mt-14 bg-white rounded-[28px] py-[38px] px-[34px] border text-center"
      style={{ borderColor: "#EAE4CA" }}
    >
      <h3 className="font-extrabold" style={{ fontSize: "clamp(24px, 3vw, 32px)", letterSpacing: "-0.02em", lineHeight: 1.1 }}>
        {t("heading")}
      </h3>
      <p className="text-base max-w-[560px] mx-auto mt-3 mb-7" style={{ color: "#4F4A4A" }}>
        {t("body")}
      </p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-7 py-[15px] rounded-full font-semibold text-[15px] text-white transition-all hover:-translate-y-0.5 cursor-pointer"
        style={{ background: "#812549" }}
      >
        {t("cta")}
      </button>

      <Modal open={open} onClose={handleClose} title={t("heading")}>
        {submitted ? (
          <div className="text-center py-6">
            <div
              className="w-12 h-12 mx-auto mb-4 rounded-full flex items-center justify-center text-xl text-white"
              style={{ background: "#00B9A6" }}
            >
              ✓
            </div>
            <h4 className="font-bold text-lg mb-1.5" style={{ color: "#1E1A1A" }}>{t("successTitle")}</h4>
            <p className="text-sm" style={{ color: "#4F4A4A" }}>{t("successBody")}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4 text-left">
            <Input
              id="food-name"
              label={`${t("nameLabel")} *`}
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={errors.name}
              required
            />
            <Input
              id="food-zip"
              label={`${t("zipLabel")} *`}
              type="text"
              autoComplete="postal-code"
              value={zip}
              onChange={(e) => setZip(e.target.value)}
              error={errors.zip}
              required
            />
            <Input
              id="food-city"
              label={t("cityLabel")}
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
            />
            <Input
              id="food-phone"
              label={t("phoneLabel")}
              type="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <Input
              id="food-email"
              label={`${t("emailLabel")} *`}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={errors.email}
              required
            />
            <div className="flex flex-col gap-1.5">
              <label className="flex items-start gap-2.5 text-sm cursor-pointer" style={{ color: "#4F4A4A" }}>
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-0.5 w-4 h-4 flex-shrink-0"
                  style={{ accentColor: "#812549" }}
                  required
                />
                {t("consentLabel")} *
              </label>
              {errors.consent && <p className="text-error text-xs">{errors.consent}</p>}
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full text-center px-7 py-[15px] rounded-full font-semibold text-[15px] text-white transition-all hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
              style={{ background: "#812549" }}
            >
              {loading ? t("submitting") : t("submit")}
            </button>
          </form>
        )}
      </Modal>
    </div>
  );
}
