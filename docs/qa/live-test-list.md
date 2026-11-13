# Clara live test list (phone)

Written 2026-11-12. Tick each line on the iPhone. "Server" marks checks that need this round's server code, which is not on production yet.

## Before you start

- Sign in with **Continue with email** (Continue with Apple does not work in this build).
- Use a **new account** to see onboarding. An account with a finished profile goes straight to the tabs.
- The build expires 7 days after install.

## 1. Welcome and sign-in

- [ ] Welcome screen says "Welcome to Clara" with three rows: Ask Clara what to eat, See your numbers, A log that fills itself.
- [ ] Continue with email creates an account and lands on onboarding step 1.

## 2. Onboarding (4 steps)

- [ ] Step 1: pick a condition, then "None", then a condition again. "Show all conditions" opens; searching "sugar" finds diabetes.
- [ ] Step 2: answering rows changes "Your starting picture". Nothing is pre-selected.
- [ ] Step 3: Continue stays grey and says what is missing until birthday, sex, height, weight, activity and allergies (or None) are set. Switching cm/kg and ft/lb keeps your numbers.
- [ ] Step 4: pick a goal and tap Start. You land on the tabs.
- [ ] Close the app on step 3 and reopen: your earlier answers are still there.
- [ ] **Server.** Close the app on step 4 without answering and reopen: you are taken straight back to step 4. "Not now" is the only way to skip it.

## 3. Clara chat and dishes

- [ ] Empty chat shows "What are we eating?", the AI line and six cards. Tapping the message box hides the cards; leaving it empty brings them back.
- [ ] "What should I eat?" returns a dish card with reasons.
- [ ] **Server.** The dish arrives in a few seconds (target: under about 8).
- [ ] **Server.** With a new account and no logged meals, Clara talks "from your answers" and makes no claim about your week.
- [ ] The dish respects your allergies and conditions. Report any dish that does not, with a screenshot.
- [ ] "Something else" gives a different dish.
- [ ] "Plan today's dishes" asks "Anything happening today?" first.
- [ ] **Server.** Asking "help me cook eggs" returns a dish card for eggs, and "Cook this with me" opens the steps with timers.

## 4. Cooking mode

- [ ] "Cook this with me" opens the steps. Next and Back move between steps.
- [ ] Start a step timer. It counts down, and keeps running if you leave the cooking screen.
- [ ] Cooking for guests shows "Amounts are for one person. You're cooking for N, so multiply by N."
- [ ] "Done cooking" saves the chat under the dish name and it can be shared.

## 5. Cooking timer notification (could not be tested in the simulator)

- [ ] With a timer running, lock the phone. When it ends a notification arrives that starts "Step N timer is done."
- [ ] Long-press it on the lock screen: the whole cooking list shows, the finished step is marked "(timer done)" and the next step is marked "Next:".
- [ ] The first button reads "Start N min timer". Tapping it starts the next step's timer **without unlocking or opening the app**.
- [ ] Open the app afterwards: cooking mode is on the next step with that timer already counting down.
- [ ] When the next step has no timer, the button reads "Next step" and opens the app on that step.
- [ ] On the last step the button reads "Done cooking".
- [ ] With the app open on the cooking screen, a timer ending shows only the in-app bar, no banner.
- [ ] Two timers running: each sends its own notification.
- [ ] Account, Notifications: turning "Cooking timers" off stops these notifications.
- [ ] Sign out, sign in as another account: no timer notifications from the first account arrive.

## 6. After cooking

- [ ] About 30 minutes after "Done cooking", "How was the <dish>?" arrives. Long-press shows I ate it / I ate some of it / I didn't eat it.
- [ ] "I ate it" puts the dish in Log under the right day and meal. "I didn't eat it" logs nothing.

## 7. Numbers

- [ ] New account: shows "Your starting picture" from your answers, marked "An estimate".
- [ ] After three days with two or more logged meals: bars appear with words (little, on track, within limit, a lot).
- [ ] Minerals and vitamins say "Food not counted yet". A pill you take shows its amount with "an estimate".
- [ ] "What this supports" tiles say "not counted yet" unless every nutrient they use is counted.
- [ ] Drag a level: status changes to "Trying a change". Reset puts it back. "Save as my goal" shows "Goal saved" and the goal next to the row.
- [ ] Edit: Track all, Clear all, and single toggles stick after Done. "Pills I take" lists your pills; Remove asks first.
- [ ] Tap Weight (only shown if you chose Lose or Gain): enter today's weight; it shows in your own unit.

## 8. Log

- [ ] Dishes are listed by day, newest first. Swipe to delete asks first.

## 9. Account

- [ ] "Conditions and eating" reopens onboarding with your saved answers and in your own units.
- [ ] Notification switches turn each notification on and off.

## What to send back

For anything wrong: what you tapped, what you expected, what happened, and a screenshot.
