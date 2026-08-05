import { Suspense } from "react";
import AcceptInviteClient from "@/components/restaurant/AcceptInviteClient";

export const metadata = { title: "Accept Invite" };

// Phase 6a M2 — the landing page a Clerk invitation email redirects to
// after sign-up (design §4A step 3). The client component reads ?inviteId=
// and calls the accept endpoint.
export default function AcceptInvitePage() {
  return (
    <Suspense>
      <AcceptInviteClient />
    </Suspense>
  );
}
