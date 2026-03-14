export const metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto px-5 py-16">
      <h1 className="text-3xl font-bold text-navy mb-8">Privacy Policy</h1>

      <div className="space-y-6 text-[#33303C] text-sm leading-relaxed">
        <section>
          <h2 className="font-semibold text-navy text-base mb-2">1. Information We Collect</h2>
          <p>
            We collect information you provide when creating an account, including your name,
            email address, and health profile data (height, weight, dietary preferences).
            We also collect usage data and meal planning interactions to improve your experience.
          </p>
        </section>

        <section>
          <h2 className="font-semibold text-navy text-base mb-2">2. How We Use Your Information</h2>
          <p>
            Your information is used to provide personalized meal planning, generate your health
            journey statistics, process subscriptions via Stripe, and send service-related
            communications. We never sell your personal data to third parties.
          </p>
        </section>

        <section>
          <h2 className="font-semibold text-navy text-base mb-2">3. Data Storage & Security</h2>
          <p>
            Your data is stored securely on servers in the United States using industry-standard
            encryption. Passwords are hashed using bcrypt and never stored in plaintext.
          </p>
        </section>

        <section>
          <h2 className="font-semibold text-navy text-base mb-2">4. Your Rights</h2>
          <p>
            You have the right to access, correct, or delete your personal data at any time.
            Contact us at privacy@wondish.io to exercise these rights.
          </p>
        </section>

        <section>
          <h2 className="font-semibold text-navy text-base mb-2">5. Cookies</h2>
          <p>
            We use session cookies for authentication and local storage for grocery list
            preferences. We do not use third-party tracking cookies.
          </p>
        </section>

        <section>
          <h2 className="font-semibold text-navy text-base mb-2">6. Changes to This Policy</h2>
          <p>
            We may update this policy from time to time. We will notify you of significant
            changes via email or in-app notification.
          </p>
        </section>

        <p className="text-[#8A8D93] text-xs">Last updated: March 2026</p>
      </div>
    </div>
  );
}
