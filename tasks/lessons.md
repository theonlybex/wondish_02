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
