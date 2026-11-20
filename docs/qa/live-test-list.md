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

## 6d. Features added in the second round, 2026-11-17

Same rules as 6c. Two things to know for the simulator:
- A launch word that carries a sentence uses dashes for spaces (`-mealSuggestTapped Lentil-soup`).
- The first launch after a new build sometimes ignores the launch words. Stop the app and launch it again.

Three of these need a server deploy before the phone check works: the dish suggestion, the photo in the Log, and Apple Health's numbers. Each says so.

### Dark mode
- [ ] **Phone.** Settings, "Appearance": choose Dark. Every screen turns to a warm near-black with cream text; buttons stay crimson with white text; crimson words and icons turn light rose. Check Clara, a dish card, cooking mode, Numbers, Log, Notifications.
- [ ] **Phone.** Choose "Same as iPhone": the app follows the phone's own Light and Dark setting. Choose Light: it stays light.
- [ ] **Phone.** Sign out: the welcome screens are always light.
- [ ] **Phone.** Look for any text that is hard to read in Dark and send a screenshot.
- [ ] **Simulator.** Add `-appearance dark` to any launch, for example `-UITestFixture chatDishAdvice -appearance dark`, `-UITestFixture numbersFull -tab numbers -appearance dark`, `-UITestFixture logLoaded -tab log -appearance dark`, `-UITestFixture cookMode -appearance dark`.

### Dish suggestion on the meal reminder
- [ ] **Phone. Server (not deployed yet).** Open the app once in the morning. At your lunch time the notification reads "How does <dish> sound for lunch, <your first name>?".
- [ ] **Phone.** Hold the notification: it offers "Yes", "Already ate" and "Already ate: take a picture".
- [ ] **Phone.** "Yes": the app opens a new chat, sends "I'd like <dish> for lunch. Cook it with me." and Clara answers with that dish's card.
- [ ] **Phone.** "Already ate": a text box opens in the notification. Type what you had and send: the app opens and Clara estimates it and asks before logging.
- [ ] **Phone.** "Already ate: take a picture": the app opens on the camera.
- [ ] **Phone.** Tap the banner itself: the chat shows the same question with the boxes Yes, Already ate and Other.
- [ ] **Phone.** Settings, Notifications, turn "Suggest a dish" off: the next reminder reads "Did you have lunch?" again.
- [ ] **Phone.** The dish never contains a food you are allergic to or avoid, and is not a dish you logged in the last 7 days.
- [ ] **Simulator.** Add `-mealSuggestTapped Lentil-soup`: the chat shows "How does lentil-soup sound for lunch, Fixture?" with Yes, Already ate, Other. Tap "Already ate": Clara asks "What did you have for lunch?" and the keyboard opens.
- [ ] **Simulator.** Add `-mealSuggestYes Lentil-soup`: a new chat opens with "I'd like Lentil-soup for lunch. Cook it with me." sent.
- [ ] **Simulator.** `-UITestFixture notificationSettings`: "Suggest a dish" shows under the meal reminders.

### Voice mode while cooking
- [ ] **Phone.** In cooking mode tap the microphone (top right). iOS asks for Speech Recognition and the Microphone once. The microphone turns crimson and a box above the buttons says "Listening".
- [ ] **Phone.** Say "next step": the screen moves on and Clara reads the step aloud. Say "repeat": she reads it again. Say "go back": the step before.
- [ ] **Phone.** On a step with a timer say "start the timer": it starts and she says how many minutes. "Pause the timer", "resume the timer" and "how long is left on the timer" work.
- [ ] **Phone.** Ask a question ("It's too salty, what can I do?"): the box shows "Clara is thinking", then she reads the answer. The question and answer are in the chat afterwards.
- [ ] **Phone.** When Clara's answer ends with answer boxes she says "You can say: ...". Say one of them: it is sent.
- [ ] **Phone.** While she speaks she does not hear her own voice as a question.
- [ ] **Phone.** Say "stop listening", or tap the microphone: it goes off. Leaving cooking mode also turns it off.
- [ ] **Phone.** Try it with a pan sizzling or an extractor fan on. Note what it mishears. Note the battery after 20 minutes.
- [ ] **Phone.** Refuse the microphone permission: the box says to allow it in iOS Settings.
- [ ] **Simulator.** Start with `-UITestFixture cookMode -cookPeople 2 -cookSteps -cookVoiceSay next-step+start-the-timer`: cooking is on step 4, its timer runs, and the box shows "You: start the timer" and "Clara: Timer started: 2 minutes." The simulator build has no microphone and no sound: the sentences come from the launch words.

### Siri commands
- [ ] **Phone.** While cooking a dish, say "Hey Siri, next step in Clara": Siri reads the next step and cooking mode has moved on.
- [ ] **Phone.** On a step with a timer say "Hey Siri, start the timer in Clara": the timer starts and Siri says how long.
- [ ] **Phone.** With nothing cooking: Siri says "You are not cooking anything in Clara right now."
- [ ] **Phone.** The Shortcuts app lists "Next step" and "Start the timer" under Clara.
- [ ] **Simulator.** Checked by the app tests (`CookVoiceTests.testSiriNextStepAndTimer`). Siri itself was not run in the simulator.

### Shopping list to Apple Reminders
- [ ] **Phone.** Settings, "Shopping list", with items on it: tap "Send to Reminders". iOS asks for access to Reminders once. The line under the button reads "Added 3 items to Reminders, in the list Clara shopping."
- [ ] **Phone.** Open Apple Reminders: a list "Clara shopping" holds one reminder per item, with the amount in brackets.
- [ ] **Phone.** Tap "Send to Reminders" again: "Everything is already in Reminders". Items ticked in the app are not sent.
- [ ] **Phone.** Refuse the permission: the line says to allow Reminders in iOS Settings.
- [ ] **Simulator.** Add `-openScreen shoppingList`: the list opens with three items and "Send to Reminders". Tapping it shows "Added 3 items to Reminders" (the simulator build does not touch Reminders).

### Photo in the Log
- [ ] **Phone. Server (not deployed yet).** Send a photo of a plate, answer the gram questions, tap "Log as lunch". In Log the meal shows "From a photo" and a small picture of your photo on the right.
- [ ] **Phone.** A meal logged without a photo has no picture.
- [ ] **Phone.** The picture is kept on this phone only: after deleting and reinstalling the app, old photo meals show without a picture.
- [ ] **Simulator.** Start with `-UITestFixture logLoaded -tab log`: "Tuna salad sandwich" shows "From a photo" and a small picture of a plate.

### Apple Health
- [ ] **Phone. Needs the HealthKit capability** (add your Apple ID in Xcode, then Signing & Capabilities, + Capability, HealthKit). Without it the switch says "Apple Health is not available in this build of Clara."
- [ ] **Phone. Server (not deployed yet).** Settings, "Apple Health", turn on "Use Apple Health" and allow everything on the iOS sheet. The line under the switch says how many meals from the last two weeks are in Health.
- [ ] **Phone.** Open the Health app, Browse, Nutrition, Dietary Energy: today's logged meals are there with their calories, from Clara. Protein, Carbohydrates and Total Fat too.
- [ ] **Phone.** Delete a meal in Clara's Log, open Clara again: that meal is gone from Health.
- [ ] **Phone.** Add a weight in the Health app, open Clara: Numbers shows that weight without typing it.
- [ ] **Phone.** Turn the switch off: nothing new is written.
- [ ] **Simulator.** Add `-openScreen health`: the Apple Health screen opens. Turn the switch on: it reads "1 meal from the last two weeks in Health." (a stand-in for Health; the real Health app is not used).

### Home Screen widget
- [ ] **Phone. Needs the App Groups capability** (Apple ID in Xcode, then Signing & Capabilities, + Capability, App Groups, `group.io.wondish.clara`, on both the Clara and the ClaraLiveActivity targets). Not in builds I install from here.
- [ ] **Phone.** Hold the Home Screen, tap +, search Clara, add "Clara today" in the small and the medium size.
- [ ] **Phone.** Before lunch it shows the calories logged today and "For lunch" with a dish. After lunch is logged, or after 3:00 PM, it shows "For dinner". After both are logged it shows only the numbers.
- [ ] **Phone.** Log a meal in a chat, go to the Home Screen: the number has gone up.
- [ ] **Phone.** Tap the dish: Clara opens on a chat asking how that dish sounds, with Yes and Already ate.
- [ ] **Phone.** The next morning it starts at 0 again.
- [ ] **Phone.** Sign out: the widget shows no numbers.
- [ ] **Simulator.** Add `-UITestFixture logEmpty -openScreen widget`: both sizes are drawn inside the app with "For dinner" or "For lunch" and a dish. `-UITestFixture logLoaded -openScreen widget` shows 520 kcal and 2 meals logged. The widget was not placed on the simulator's Home Screen.

## 6e. Everything in one session (added 2026-11-17)

The checks above start the app fresh for each feature. This one runs them one after another without closing the app, to catch one feature slowing or breaking the next.

- [ ] **Phone.** In one sitting, without closing the app: switch to Dark, ask "What should I eat?", tap "Cook this with me", turn the microphone on, say "next step" and "start the timer", open the share picture and close it, open "Ingredients" and add what's missing to the shopping list, go back to the chat, open Settings, send the shopping list to Reminders, turn Apple Health on, open the Log, then leave the app for the Home Screen and come back.
- [ ] **Phone.** Nothing freezes for more than a moment at any step. The timer keeps counting through all of it and its notification still arrives.
- [ ] **Phone.** The first time you say "start the timer" on a new install, iOS asks about notifications and Clara says "Timer started" only after you answer. The timer itself has already started.
- [ ] **Phone.** With a weak connection (one bar, or Settings, Developer, Network Link Conditioner, "3G"): come back to the app from the Home Screen. The screen is usable at once; the widget, Health and the reminders catch up in the background.
- [ ] **Simulator.** Delete the app from the simulator first, then start with `-UITestFixture cookMode -cookPeople 2 -cookSteps -cookVoiceSay next-step+start-the-timer -appearance dark` and do the same steps by hand. Run on 2026-11-17: every step worked and the system log showed no hang or fault. The Log tab cannot be checked this way: this fixture has no log, so it shows "Couldn't load your log."
- [ ] **Simulator.** A slow server is covered by the app test `testRemindersHealthAndTheWidgetShareOneReadOfASlowServer`: with 0.4 seconds per read, the reminders, Apple Health and the widget finish together on one request.

## 6f. Answering a meal reminder is a finished interaction (added 2026-11-20)

Replaces the older behaviour in 6b and 6d, where a typed answer opened a chat and Clara asked before logging. **Server (not deployed yet):** none of the phone checks work until `POST /api/clara/quick-log` is live.

### Typed answer: the app stays closed
- [ ] **Phone.** With Clara closed, hold "Did you have lunch?" (or the dish suggestion), tap "Tell Clara what you had" (or "Already ate"), type "chicken wrap and an apple", Send. The app does not open.
- [ ] **Phone.** Within about 15 seconds a notification "Lunch logged" arrives with the meal's name and "about N kcal". The reminder itself is gone.
- [ ] **Phone.** Open Clara, Log: the meal is under today, marked "estimate". Numbers include it.
- [ ] **Phone.** Hold "Lunch logged" and tap "Undo": the notification goes and the meal is no longer in the Log. The app does not open.
- [ ] **Phone.** Type something that is not food ("what time is it"): "Clara could not tell what that was" arrives and nothing is logged.
- [ ] **Phone.** Turn on Airplane Mode and answer a reminder: "Not logged yet" arrives. Turn Airplane Mode off and open Clara: "Lunch logged" arrives and the meal is in the Log once, not twice.
- [ ] **Phone.** Answer with the phone locked: it still logs.
- [ ] **Phone.** Compare the calories with what you would expect for three different meals and note any that are far off.
- [ ] **Simulator.** Start with `-UITestFixture claraEmpty -mealNoteTyped chicken-wrap-and-an-apple`: the start screen stays as it is (no chat opens) and a banner "Lunch logged: chicken wrap and an apple, about 520 kcal." shows. Allow notifications first if the simulator asks.

### Picture: logged as soon as it is taken
- [ ] **Phone.** Hold the reminder, tap "Take a picture" (or "Already ate: take a picture"): the app opens on the camera. Take the photo and tap "Use Photo".
- [ ] **Phone.** The chat shows your photo and "Logging your lunch…", which turns into "Logged for lunch: <name>, about N kcal. It's in your Log." Clara asks no questions and shows no answer boxes.
- [ ] **Phone.** Log shows the meal with "From a photo · estimate" and the small picture.
- [ ] **Phone.** A photo of something that is not food: "I couldn't see a meal in that photo, so nothing was logged."
- [ ] **Phone.** Cancel the camera, then ten minutes later send a normal photo in a chat: Clara asks her usual gram questions (the reminder no longer applies).
- [ ] **Phone.** A photo sent from "Photo of my plate" in the start list still gets the gram questions: only a photo taken from a reminder is logged at once.
- [ ] **Simulator.** Start with `-UITestFixture claraEmpty -mealPictureTapped -chatPhotoSample`: the chat shows the drawn plate and "Logged for lunch: Chicken salad with tomatoes, about 520 kcal. It's in your Log." The simulator's camera does not take pictures, so the sample photo stands in.

### What still opens a chat
- [ ] **Phone.** Tapping the reminder's banner (not holding it) opens Clara on a chat, as before.

## 6g. Share my diet with a chef (added 2026-11-20)

**Server (not deployed yet):** the phone checks need `/api/diet-share` and the page `/diet/<link>` live.

### In the app
- [ ] **Phone.** Settings, "Share my diet": a short explanation, "Create a link", "Send as picture", and under "What they see" your own card: allergies in a red box first, then Leave out, Go easy on, Likes.
- [ ] **Phone.** The card matches what you set in "Conditions and eating": every allergy is in the red box, every food you avoid is under Leave out.
- [ ] **Phone.** Tap "Create a link": the buttons change to "Send the link", "Copy link" and "Send as picture", with "Works until <date>" (90 days from today).
- [ ] **Phone.** "Send the link" opens the share sheet with a www.wondish.io/diet/... address. Send it to yourself.
- [ ] **Phone.** "Send as picture" shares one image of the card with "by Wondish" bottom right. It reads well when opened in Messages.
- [ ] **Phone.** "Show my health conditions" is off. The card names no condition; a heart or blood-pressure condition still shows "Low salt".
- [ ] **Phone.** Turn the switch on: the preview gains "Health conditions" and the cooking guidance for them.
- [ ] **Phone.** "Turn off link" asks first, then the screen goes back to "Create a link".

### The chef's page
- [ ] **Phone or computer.** Open the link in a browser where you are not signed in to Wondish: the card shows, with no sign-in asked.
- [ ] **Phone.** Change an allergy in "Conditions and eating", reload the chef's page: it shows the change. The address is the same.
- [ ] **Phone.** With conditions off, the page shows no condition name anywhere. Turn the switch on and reload: they appear.
- [ ] **Phone.** After "Turn off link", the old address shows "This link is no longer active". A new link has a different address.
- [ ] **Computer.** Print the page (Cmd+P): one clean page, black text, no crimson block.
- [ ] **Computer.** Search for the page in Google a few days later: it is not listed.

### Simulator and local
- [ ] **Simulator.** Start with `-UITestFixture claraEmpty -openScreen diet`: the screen shows a sample card for "Fixture". "Create a link" switches to the link buttons with "Works until February 18"; "Turn off link" goes back.
- [ ] **Local web.** Run the site (`npm run dev`) and open `http://localhost:3000/diet/sample` (conditions hidden) and `http://localhost:3000/diet/sample-conditions`: a sample card for "Mia". Any other address shows "This link is no longer active". The sample address does not work on the live site.

## 6h. Posting a dish or your diet to social media (added 2026-11-20)

Both use the iPhone share sheet, which lists Instagram, TikTok, WhatsApp, Facebook, X and Messages when they are installed. No server change is needed.

### A dish
- [ ] **Phone.** In cooking mode tap the share button. Under the picture there are three shapes: Recipe, Post, Story. The picture changes as you switch.
- [ ] **Phone.** Take or choose a photo of the dish. "Post": your photo fills the top, the name and ingredients are under it, "Cooked with Clara" and "by Wondish" at the bottom.
- [ ] **Phone.** "Post", then "Post or share", choose Instagram, then Post: the whole picture shows with nothing cut off.
- [ ] **Phone.** "Story", then "Post or share", choose Instagram, then Story: it fills the screen. The first four steps show, then "and N more steps".
- [ ] **Phone.** Try the same picture in WhatsApp, TikTok and Facebook, whichever you have.
- [ ] **Phone.** "Post or share", then "Save Image": iOS asks once for permission to add to Photos, and the picture is in Photos. The app does not crash.
- [ ] **Phone.** A dish with a very long recipe: Post and Story stay the same size and nothing overflows.
- [ ] **Phone.** Close and reopen "Share dish" for another dish: the shape you used last is still selected.
- [ ] **Simulator.** Start with `-UITestFixture cookMode -cookShareOpen -dishShare.format post` (or `story`): the picture shows in that shape, with a crimson top when there is no photo.

### Your diet
- [ ] **Phone.** Settings, "Share my diet", "As a picture": Card, Post, Story. Post and Story read "How I eat" with your name, allergies under "Never: allergy", "I leave out" and "I like".
- [ ] **Phone.** Turn "Show my health conditions" on, then choose Post or Story: no condition is named and there is no salt note. Conditions only ever show on the chef's Card and link.
- [ ] **Phone.** "Post or share" to an Instagram story and to a feed post: nothing is cut off.
- [ ] **Phone.** A long avoid list ends with "and N more".
- [ ] **Simulator.** Start with `-UITestFixture claraEmpty -openScreen diet -dietShare.format story` and scroll down: "The picture" shows the story shape for "Fixture".

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
