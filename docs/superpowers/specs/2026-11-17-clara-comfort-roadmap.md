# Clara comfort roadmap

Written 2026-11-17 from the owner's replies to the feature list. Each item says what the owner decided, how it will be built, and where it stands.

## Done in batch 1 (2026-11-17)

| Item | What was built |
|---|---|
| Start list | The six boxed cards became six short lines with no boxes: What should I eat?, Plan my day, Cook with me, Photo of my plate, Photo of a menu, Photo of my fridge. The photo lines open the camera with a note waiting in the message box. "Can I eat this?", "I just ate…" and "How am I doing?" still work when typed. |
| Loading tips | The launch screen shows a rotating tip (fridge photo, plate photo, menu photo, regular meal times, reminders, lock-screen timers). "Try again" appears only after 8 seconds. |
| How hungry are you? | Asked on the first cooking screen: Half, Full, Double. Amounts follow it, and "I ate it" logs that size. The server accepts 0.25, 0.5, 1 and 2 servings (needs a deploy). |
| Settings in the chats list | A Settings row at the bottom of the chats list opens the account screen (notifications, What Clara remembers, account). |
| Haptics | One helper (`Haptics`): a tap on send, timer start, pause and resume; a tick on answer boxes, start-list lines, next step, people and checklist; success on a photo attached and Done cooking; warning on a deleted log; error on a reply that could not finish. |

## Done in batch 2 (2026-11-17)

| Item | What was built |
|---|---|
| Share a dish as a picture | "Share dish" from cooking mode and the chats list: the person's photo on top (or a crimson header), the recipe, "by Wondish" bottom right. The photo is kept on the phone per chat and dish. |
| Sunday summary | Sunday 18:00 notification; a tap asks Clara for the week and one easy win. Own switch. |
| Learned meal times | The time a meal is logged in a chat is noted; after 5 days the reminder moves to that time plus 30 minutes. A hand-set time wins. A dish cooked with Clara keeps that meal's reminder quiet that day. |
| Shopping list | "Add what's missing to my shopping list" on "What you need"; a list in Settings with tick, remove and share. Sending straight into Apple Reminders as separate items is not built. |
| Menu and fridge photos, server | Specific instructions for a menu (up to 4 dishes, what to ask the kitchen) and a fridge (ingredients seen, one dish card). Needs a deploy. |

Every feature has a phone check and a simulator check in `docs/qa/live-test-list.md`, section 6c.

## Next, in this order

### 1. Share a dish as a picture (owner: priority)
A card image: the dish picture on top, the recipe under it, a small "by Wondish" in the bottom right corner. Shared through the iOS share sheet.
- Rendered on the phone with `ImageRenderer` from a SwiftUI view, so no server work.
- The picture on top is the person's own photo of the cooked dish (taken at "Done cooking" or picked later). With no photo, the card uses a plain crimson header with the dish name. Open question for the owner: should Clara offer "Take a photo of your dish" at Done cooking?

### 2. Home-screen widget (owner: priority)
Small and medium widgets: today's numbers, or tonight's dish.
- Needs a widget extension and an App Group to pass data from the app.
- Blocked on signing: Xcode has no Apple account, so extensions cannot be signed for the phone (the cooking Live Activity is already left out for this reason). Needs the owner's Apple ID in Xcode ▸ Settings ▸ Accounts.

### 3. Lunch and dinner suggestion notification
Replaces the plain "Did you have lunch?". Text: "How does <dish> sound for lunch, <first name>?" Buttons: "Yes" and "Already ate".
- Yes: opens the chat on that dish's card, ready to cook.
- Already ate: the text box and "Take a picture" from the current reminder.
- The dish must be picked ahead of time, because a local notification cannot call the server when it fires. The app asks the server for the next meal's dish whenever it comes to the front and stores the name in the scheduled notification. Needs a small server route that returns one suggested dish per meal.

### 4. Learned meal times
- The app records when each meal is actually logged and moves each reminder toward the person's usual time (median of the last 14 days, in 15-minute steps, at least 5 logs before it moves).
- No dinner reminder on a day a dish was cooked with Clara in the evening.
- Later: a loading tip or Sunday line about eating at regular times, using the person's own times.

### 5. Sunday summary
One short message from Clara on Sunday evening: how the week went and one easy win. A local notification opens a new chat that asks the server for the summary.

### 6. Photo in the Log
A photo meal shows its thumbnail next to the Log entry.
- Photos stay on the phone today (the server never stores them). The log row needs to know which photo it came from: one new optional column `photoId` on the meal log, filled by `logs_create` in a photo chat. The app shows its local copy for that id.
- Needs a database migration (owner's go-ahead). Thumbnails do not follow the person to a new phone unless photos are later uploaded to storage.

### 7. Voice mode while cooking
"Talk to Clara like voice mode: she listens the whole time while cooking."
- On the phone: Apple speech recognition listens continuously on the cooking screen, sends each finished sentence to the existing "Ask Clara while cooking" path, and reads the answer aloud. Spoken commands "next step", "start the timer", "repeat" are handled on the phone without the server.
- Needs microphone and speech permissions. Risks to test on a real phone: kitchen noise, the phone's own voice being heard as a question, battery.

### 8. Siri commands
"Next step in Clara", "Start the timer in Clara" through App Intents. The cooking Live Activity already has the same two actions.

### 9. Shopping list
Today: the server has a grocery list built from the weekly meal plan (`/api/grocery-list`) and a pantry "to buy" list (`/api/pantry/to-buy`). The Clara-first app shows neither; the meal plan screens are switched off.
- Plan: on "What you need" in cooking mode and on a dish card, "Add what's missing to my list" puts the unticked ingredients, with amounts for the people cooked for, on one shopping list kept on the phone. A "Shopping list" row in Settings shows it, with tick-off and "Send to Reminders".
- Reuse the pantry "to buy" route later if the list should sync with the website.

### 10. Apple Health
Read weight and active energy so they are not typed; write logged meals as dietary energy, protein, carbs and fat. Needs the HealthKit capability, which a personal developer team may not allow: check before building.

### 11. Dark mode
The classic Wondish palette in dark: every colour in `Theme.swift` gets a dark value, then every screen is checked for contrast.

### 12. Menu and fridge photos, server side
The start list already sends these photos with a note. The server prompt still treats "not food" photos generally. Add specific instructions: a menu returns the dishes that fit with what to ask the kitchen; a fridge returns dish cards from what is visible.

## Noted, not planned yet
- Apple Watch: no way to test at the moment.
- Louder repeating timer alarm and timers through Focus mode: from the earlier list, not raised again.
