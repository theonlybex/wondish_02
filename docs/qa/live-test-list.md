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
- [ ] **Server.** Every question Clara asks comes with answer boxes under it, plus "Other…", which opens the keyboard for your own answer. The question is written once.

## 3b. Photo of your food (added 2026-11-14)

Needs the server branch `feat/clara-photo` on production. Before it is deployed, a photo with no words fails with "Couldn't finish", and a photo with words gets an answer to the words only.

- [ ] The camera button left of the message box offers "Choose from library" (and "Take photo" on a phone).
- [ ] A picked or taken photo waits above the box with an ×; × removes it. The box says "Add a note (optional)".
- [ ] Send with no words: the photo shows on the right of the chat. Clara names each food with a gram guess, then asks one question at a time (up to 3) with gram boxes, oil or sauce first, each ending in "Just estimate".
- [ ] Tapping a gram answer logs nothing. A note like "200 g rice, no oil" skips those questions. An apple gets no questions.
- [ ] After the answers (or "Just estimate"): a list of foods with grams, calories, protein, carbs and fat, what it adds to your day, and boxes: "Log as lunch" (the meal for now), another meal, "Don't log".
- [ ] "Log as lunch" puts it in Log under today's lunch with the same numbers. "Don't log" logs nothing.
- [ ] A photo of something that is not food (a menu, a label): Clara says what she sees and helps with that.
- [ ] **Simulator.** Start with `-UITestFixture claraEmpty -chatPhotoSample`: a drawn plate waits above the message box; send it and a sample reply with "Log as lunch" boxes comes back (no real estimate).
- [ ] Close and reopen the chat: the photo is still there on this phone. The chat is titled by your words, or "Photo of my food".
- [ ] Turn off Wi-Fi, send a photo, see "Couldn't finish — Tap to retry", turn Wi-Fi on, tap retry: the photo is sent again, with one bubble only.

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

## 6b. Meal reminders (added 2026-11-17)

Phone checks, plus one simulator check at the end.

- [ ] Account, Notifications shows "Meal reminders": breakfast off, lunch on at 1:00 PM, dinner on at 7:00 PM. Each time can be changed.
- [ ] Set lunch time to two minutes from now and leave the app: "Did you have lunch?" arrives.
- [ ] Tap it: the app opens a new chat where Clara asks "What did you have for lunch?".
- [ ] Hold it: "Tell Clara what you had" (a text box), "Take a picture" and "Not yet". Typed words are sent to Clara in a new chat; "Take a picture" opens the camera; "Not yet" does nothing.
- [ ] Log lunch first, then wait for lunch time: no reminder that day.
- [ ] Turning a meal's switch off stops its reminder.
- [ ] **Simulator.** Start with `-UITestFixture claraEmpty -mealCheckInTapped lunch`: a new chat opens where Clara asks "What did you have for lunch?". Start with `-UITestFixture notificationSettings` to see the Meal reminders section.

## 6c. Features added 2026-11-17

Each feature has a **Phone** check (the live app, signed in) and a **Simulator** check (no sign-in needed). Simulator checks start the app with:

```bash
xcrun simctl launch booted io.wondish.clara -UITestFixture claraEmpty
```

Add the extra words given in each check to the end of that line. Stop the app first with `xcrun simctl terminate booted io.wondish.clara`.

### Start list
- [ ] **Phone.** A new chat shows six short lines with no boxes: What should I eat?, Plan my day, Cook with me, Photo of my plate, Photo of a menu, Photo of my fridge. "What should I eat?" sends at once and a dish card comes back.
- [ ] **Phone.** "Photo of a menu" opens the camera; after the photo, the note "This is a restaurant menu. Which dishes fit me?" waits in the box. Send it. **Server (not deployed yet):** Clara names up to 4 dishes from the menu, why each fits, and what to ask the kitchen.
- [ ] **Phone.** "Photo of my fridge" does the same with its note. **Server (not deployed yet):** Clara names the ingredients she sees and shows one dish card.
- [ ] **Simulator.** Start with `claraEmpty`: the six lines show. Tap the message box: they hide; tap outside with the box empty: they return.

### Loading tips
- [ ] **Phone.** Close the app fully and open it: under the Clara name a tip shows and changes about every 4 seconds. No "Try again" in the first 8 seconds.
- [ ] **Phone.** Turn on Airplane Mode and open the app: after about 8 seconds "Try again" appears.
- [ ] **Simulator.** Checked by the app tests only (`testLoadingTipsGoRoundTheList`); the offline fixtures skip the loading screen.

### How hungry are you?
- [ ] **Phone.** "Cook this with me" on a dish card: the first screen asks "How hungry are you?" (Half, Full, Double; Full is selected) above "How many people are you cooking for?".
- [ ] **Phone.** Pick Double, then 1 person: "What you need" shows twice the amounts and its title ends with "double portions".
- [ ] **Phone. Server (not deployed yet).** Finish cooking a Double dish, answer "I ate it" on "How was the dish?": Log shows it at 2 servings. Half and "I ate some of it" gives a quarter.
- [ ] **Simulator.** Start with `-UITestFixture cookMode`: the question shows with Full selected; tapping Half or Double moves the selection.

### Settings in the chats list
- [ ] **Phone.** Tap the list button (top left of Clara): a "Settings" row sits at the bottom of the chats list. Tap it: the chats list closes and the account screen opens, with "What Clara remembers", "Notifications" and "Shopping list".
- [ ] **Simulator.** Start with `-UITestFixture chatsWithCooked`, open the chats list: the Settings row is at the bottom and opens the account screen.

### Haptics
- [ ] **Phone.** A light tap is felt when: sending a message, tapping an answer box, tapping a start-list line, moving to the next cooking step, starting or pausing a timer, ticking an ingredient. A stronger double tap on "Done cooking" and when a photo is attached.
- [ ] **Simulator.** Cannot be felt in the simulator. Not testable there.

### Sunday summary
- [ ] **Phone.** Account, Notifications shows "Sunday summary" (on). On Sunday at 6:00 PM "Your week with Clara" arrives. Tap it: a new chat opens and Clara answers how the week went with one easy win.
- [ ] **Phone.** Turn the switch off: no notification the next Sunday.
- [ ] **Simulator.** Add `-weeklySummaryTapped`: a new chat opens with "How did my week go? Give me one easy win for next week." already sent.

### Reminders at your usual times
- [ ] **Phone.** Account, Notifications shows "Use my usual times" (on) under the meal reminders.
- [ ] **Phone.** Log lunch through a chat on 5 different days at about the same time (say 12:15). The lunch row then reads "Lunch time (your usual)" and shows that time plus half an hour, to the quarter hour (12:45).
- [ ] **Phone.** Change the lunch time by hand: the row goes back to "Lunch time" with your time.
- [ ] **Phone.** Cook a dish with Clara in the evening and tap "Done cooking": no "Did you have dinner?" that day.
- [ ] **Simulator.** Checked by the app tests (`MealCheckInTests`): five logged days move the reminder, a hand-set time wins, a cooked dinner keeps the day quiet.

### Share a dish as a picture
- [ ] **Phone.** In cooking mode tap the share button (top right): "Share dish" shows the card with a crimson header, the ingredients, the steps and "by Wondish" bottom right.
- [ ] **Phone.** "Take photo": your photo replaces the crimson header and the dish name moves under it. "Share picture" opens the iOS share sheet with one image. Send it to yourself and check it reads well.
- [ ] **Phone.** Close and reopen "Share dish" for the same dish: the photo is still there. "Share as text" shares the recipe as words.
- [ ] **Phone.** In the chats list, the share button on a cooked dish opens the same screen.
- [ ] **Simulator.** Start with `-UITestFixture cookMode -cookShareOpen`: the card for "Lentil & spinach stew" shows. "Choose photo" puts a library photo on top.

### Shopping list
- [ ] **Phone.** In cooking mode on "What you need", leave two ingredients unticked and tap "Add what's missing to my shopping list": it says "Added 2 items to your shopping list."
- [ ] **Phone.** Settings, "Shopping list": both items show with their amounts and "For <dish>". Tap one: it is ticked and struck through. "Remove what's ticked" removes it. Swipe removes one. The share button sends the rest as text.
- [ ] **Phone.** Add the same dish's missing items again: "Already on your shopping list."
- [ ] **Simulator.** Start with `-UITestFixture cookMode`, tap "Ingredients", then the add button; then check Settings, "Shopping list" (person button, top right of Clara).

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
