export const metadata = { title: "Privacy Policy" };

const h2 = "font-semibold text-navy text-base mb-2";
const list = "list-disc pl-5 space-y-1 mt-2";

export default function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto px-5 py-16">
      <h1 className="text-3xl font-bold text-navy mb-8">Privacy Policy</h1>

      <div className="space-y-6 text-[#33303C] text-sm leading-relaxed">
        <section>
          <p>
            This policy covers the Wondish website (wondish.io) and the Clara app for iPhone. Both
            are run by Painless Food Corporation (&ldquo;we&rdquo;). It says what we collect, why,
            who else receives it, how long we keep it, and how you can delete it.
          </p>
        </section>

        <section>
          <h2 className={h2}>1. What we collect</h2>
          <ul className={list}>
            <li>
              <strong>Account:</strong> your name, email address and, if you add one, a profile
              picture. Sign-in is handled by Clerk; we never see or store your password. If you use
              Sign in with Apple, we receive the name and email address Apple passes on, which may
              be a private relay address.
            </li>
            <li>
              <strong>Health profile:</strong> the health conditions you choose, food allergies,
              foods you avoid, birthday, sex, height, weight, goal weight, activity level and any
              supplements you list.
            </li>
            <li>
              <strong>What you eat:</strong> meals you log, your usual eating habits, ingredients
              you keep at home, dishes you cook or save, meal plans, grocery lists and journal
              entries.
            </li>
            <li>
              <strong>Chats with Clara:</strong> the messages you send, Clara&rsquo;s answers, and
              the short notes Clara keeps about you (&ldquo;memories&rdquo;), which you can read and
              delete in the app.
            </li>
            <li>
              <strong>Food photos:</strong> a photo you send to Clara is passed to the AI service
              to be read and is not stored on our servers. A copy stays on your phone so you can
              see it in your chat and log.
            </li>
            <li>
              <strong>Payments:</strong> if you subscribe on the website, Stripe processes the
              payment. We receive your subscription status, not your card number.
            </li>
            <li>
              <strong>Feedback:</strong> what you write when you report a problem, and a screenshot
              if you attach one.
            </li>
            <li>
              <strong>Technical data:</strong> error reports, your time zone, and the request logs
              any server keeps (such as IP address and time of request).
            </li>
          </ul>
        </section>

        <section>
          <h2 className={h2}>2. Clara is an AI, and what is sent to the AI service</h2>
          <p>
            Clara&rsquo;s answers are written by an AI model run by Anthropic, PBC. To answer you,
            we send Anthropic your message, any food photo you attach, your first name, earlier
            messages in the same chat, Clara&rsquo;s memories about you, and the parts of your
            profile and food log that are needed for the answer (for example your health
            conditions, allergies, age, sex, weight and recent meals). We do not send your email
            address or payment details.
          </p>
          <p className="mt-2">
            The Clara app asks for your permission before any of this is sent. If you do not agree,
            you can sign out and delete your account. Anthropic processes this data on our behalf
            to produce the answer; it is not used for advertising.
          </p>
        </section>

        <section>
          <h2 className={h2}>3. Apple Health</h2>
          <p>
            Apple Health is off until you switch it on in the Clara app. When it is on, Clara reads
            your most recent weight from Health and saves it to your profile, and writes the meals
            you log to Health as energy, protein, carbohydrate and fat. Clara reads nothing else
            from Health. Data from Apple Health is used only to run these features for you. It is
            never used for advertising or marketing, never sold, and never stored in iCloud by us.
            Your weight, like the rest of your profile, may be included in what is sent to the AI
            service described in section 2.
          </p>
        </section>

        <section>
          <h2 className={h2}>4. Permissions on your phone</h2>
          <p>The Clara app asks for each of these only when you use the feature that needs it:</p>
          <ul className={list}>
            <li><strong>Camera and photo picker:</strong> to send Clara a photo of food, a menu or your fridge.</li>
            <li>
              <strong>Microphone and speech recognition:</strong> to follow spoken commands while
              you cook. Speech is turned into text by Apple&rsquo;s speech recognition; we do not
              keep audio recordings.
            </li>
            <li><strong>Reminders:</strong> to add your shopping list to the Reminders app and avoid adding an item twice.</li>
            <li><strong>Saving to Photos:</strong> to save a picture of a dish or your diet card when you choose to.</li>
            <li><strong>Notifications:</strong> for meal reminders, cooking timers and a weekly summary. You can turn each off.</li>
          </ul>
        </section>

        <section>
          <h2 className={h2}>5. How we use your information</h2>
          <p>
            We use it to suggest dishes that fit your conditions, show how your eating measures up,
            keep your log and plans, answer your questions through Clara, process subscriptions,
            fix errors, prevent abuse, and send service messages such as sign-in codes. We do not
            sell your personal data, we do not show advertising, and we do not track you across
            other companies&rsquo; apps and websites.
          </p>
        </section>

        <section>
          <h2 className={h2}>6. Who receives your information</h2>
          <p>Only the companies that help us run the service, each for the purpose named:</p>
          <ul className={list}>
            <li><strong>Anthropic:</strong> the AI model behind Clara (section 2).</li>
            <li><strong>Clerk:</strong> sign-in and account identity.</li>
            <li><strong>Stripe:</strong> payments made on the website.</li>
            <li><strong>Apple:</strong> Sign in with Apple, and Apple Health if you switch it on.</li>
            <li><strong>Vercel, Neon and Amazon Web Services:</strong> hosting, the database and file storage.</li>
            <li><strong>Upstash:</strong> limits on how often requests can be made, to prevent abuse.</li>
            <li><strong>Sentry:</strong> error reports, so we can fix faults.</li>
          </ul>
          <p className="mt-2">
            If you create a &ldquo;Share my diet&rdquo; link, anyone you give the link to can see
            the diet summary it shows. Your conditions are included only if you choose to include
            them, and you can switch the link off at any time. We may also disclose information
            when the law requires it.
          </p>
        </section>

        <section>
          <h2 className={h2}>7. Where and how long we keep it</h2>
          <p>
            Your data is stored on servers in the United States and is encrypted in transit. We
            keep your account, profile and food log for as long as your account exists. A chat
            with Clara is deleted 180 days after its last message. When you delete your account,
            your profile, logs, chats, memories and feedback screenshots are deleted from our
            systems; copies in backups and logs expire on their normal schedule.
          </p>
        </section>

        <section>
          <h2 className={h2}>8. Your choices</h2>
          <ul className={list}>
            <li>
              <strong>Delete your account:</strong> in the Clara app, open Account and choose
              &ldquo;Delete account&rdquo;. If you only use the website, write to privacy@wondish.io
              and we will delete it for you. Deletion cannot be undone.
            </li>
            <li><strong>See or correct your data:</strong> your profile, log and memories can be edited in the app and on the website.</li>
            <li>
              <strong>Withdraw permission:</strong> switch off Apple Health, notifications, the
              microphone or the camera in the app or in iPhone Settings. To stop data going to the
              AI service, stop using Clara and delete your account.
            </li>
            <li>
              <strong>Ask us:</strong> for a copy of your data, or for anything else about it,
              write to privacy@wondish.io.
            </li>
          </ul>
        </section>

        <section>
          <h2 className={h2}>9. Not medical advice</h2>
          <p>
            Wondish and Clara give general information about food. They are not a medical service
            and do not diagnose or treat any condition. Check with your doctor before you change
            how you eat for a health condition.
          </p>
        </section>

        <section>
          <h2 className={h2}>10. Children</h2>
          <p>
            The service is not meant for children under 13, and we do not knowingly collect their
            data. If you believe a child has given us data, write to privacy@wondish.io and we will
            delete it.
          </p>
        </section>

        <section>
          <h2 className={h2}>11. Cookies</h2>
          <p>
            The website uses cookies to keep you signed in and local storage for preferences such
            as your grocery list. We do not use third-party tracking or advertising cookies.
          </p>
        </section>

        <section>
          <h2 className={h2}>12. Changes to this policy</h2>
          <p>
            If we change this policy in a way that matters, we will tell you by email or in the
            app before the change takes effect.
          </p>
        </section>

        <p className="text-[#848181] text-xs">Last updated: November 2026</p>
      </div>
    </div>
  );
}
