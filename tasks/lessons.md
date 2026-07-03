## Lesson: when adopting part of the user's idea, confirm the dropped part explicitly (2026-07-02)

**Mistake:** User proposed hiding BOTH previous and next days in the meal plan.
I recommended capping only forward browsing, they approved, and I silently
kept the back button — they had to point it out.

**Rule:** When a recommendation adopts only part of what the user floated,
name what's being left out and why in one sentence ("keeping the back button
because X — want it gone too?"). Approval of a recommendation is not approval
of its omissions.

## Lesson: never run `npm run build` while the user's dev server is running (2026-07-02)

**Mistake:** Verified a component change with `npm run build` while the user's
`npm run dev` was serving the app. Both write to the same `.next` directory, so
the production build clobbered the dev server's artifacts — layout.css started
404ing and the user saw unstyled HTML, which looked like a bug in the feature
they were testing.

**Rule:** Before running `next build` in this repo, check for a running dev
server (`Get-Process node`) or ask. Prefer `npx tsc --noEmit` + `npm run lint` +
`npm test` for verification while a dev server is up; save `next build` for when
it's stopped.

## Lesson: sanity-check model semantics, not just code correctness (2026-06-11)

**Mistake:** Wired the prediction what-if card's exercise slider straight into the
caloric engine's activity level. The engine raises both burn (TDEE) and intake
floor (goal-weight maintenance at the same activity level) together, so more
exercise barely moved the result (~0.1 lbs/wk). Code was "correct" but the model
semantics were wrong for the feature: the meal plan is generated at the profile's
activity level, so extra exercise should be pure additional burn.

**Rule:** When exposing an internal model through a new interactive control, trace
what the parameter actually changes end-to-end and check output deltas against
real-world intuition BEFORE shipping. If a slider barely changes the output, ask
whether the model is answering the question the UI is asking.
