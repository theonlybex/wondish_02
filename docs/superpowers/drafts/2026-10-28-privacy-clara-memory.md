# Privacy policy draft: Clara chats and Clara's memory

**Status: DRAFT for review. Not published.** `app/(main)/privacy/page.tsx` has not been edited.
Needs a human (and ideally legal) read before it goes live.

The live policy has six numbered sections, each an `<h2>` followed by one short paragraph, in plain
second-person language ("we", "you"). The draft below keeps that tone and length. Nothing here changes
who data is shared with.

---

## Insert into section 1, "Information We Collect" (append to the existing paragraph)

> If you use Clara, our AI food assistant, we also save the chats you have with her, and short notes
> Clara keeps about you, such as how many people you cook for or foods your household avoids.

## Insert into section 2, "How We Use Your Information" (append to the existing paragraph)

> Your saved chats let you pick a conversation back up later. Clara's notes are used only to make her
> answers fit you better, so you don't have to repeat yourself. Neither is used for advertising.

## New section, to sit after section 4 "Your Rights" (renumber 5 and 6 to 6 and 7), heading: "5. Clara Chats and Memory"

> **Saved chats.** Your conversations with Clara are saved to your account so you can come back to
> them. You can delete any chat yourself at any time from the Clara page. A chat you haven't added to
> for 180 days is deleted automatically, along with its messages.
>
> **What Clara remembers.** When you tell Clara something worth keeping, she may save a short note
> about it. You can see everything she has saved under "What Clara remembers" on your Profile page, and
> you can forget any note, or clear them all, whenever you like. Notes stay until you delete them. They
> are not removed when an old chat is deleted, so use the Profile page if you want them gone. Deleting
> your account removes them too.
>
> **Who sees this.** Chats and notes are tied to your account and are visible to you. They are handled
> the same way as the rest of your data described in this policy, and this feature does not change who
> we share data with. Clara is an AI and can make mistakes; please don't share anything in a chat that
> you wouldn't want saved, and check anything medical with your doctor or dietitian.

## Section 4, "Your Rights" (optional one-line addition)

> You can also view and delete your Clara chats and Clara's notes yourself, without contacting us.

## Last line

Bump "Last updated" from March 2026 to the publish month.

---

## Notes for the reviewer

- The 180-day figure matches `CONVERSATION_RETENTION_DAYS` in `lib/clara/retention.ts` (counted from the
  chat's last activity, i.e. `updatedAt`), enforced by `/api/cron/clara-conversation-purge`.
- Memories deliberately have no expiry: kept until the member deletes them (or the account is deleted).
  The conversation purge leaves them alone. Their link to the source chat is cleared, not the memory.
- The existing policy says nothing about AI providers or health data processors. If Clara chat text is
  sent to an AI provider, check whether the current "never sell your personal data" wording is enough
  or whether the provider should be named. That is a wording decision for the owner, not changed here.
- The existing policy mentions bcrypt passwords while sign-in is Clerk. Unrelated, but worth a pass.
