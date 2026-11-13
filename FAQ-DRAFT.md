# Bible Study Reader: FAQ (English draft, 2026-11-13)

**Status (2026-11-13):** the 12 **[core]** questions are now in the app (How to Use → FAQ; text in `app/js/locales/en/ui_en.json`, keys `faq_*`); edit them there. The **[later]** questions below are not built yet. The ⚠ CHECK items about answers kept on update and Android backup were checked against the code and resolved in the app text.

Plain, short English on purpose: many readers use English as a second language, and the answers will be translated.

How to read this draft:
- **[core]** = in the first release (12 questions). **[later]** = add if the first release is well received.
- Menu paths were checked against the app's code on 2026-11-13.
- **⚠ CHECK** marks a statement I could not confirm from the code. Please confirm or correct it before it ships.
- Each answer is three sentences or fewer, and points to a page that already explains the feature rather than repeating it.

---

## Getting started

### Is the app free? Do I need an account? [core]
The app is free. You do not need an account, and there are no adverts. Your answers stay on your phone.

### Do I need internet? [core]
No, not to study. Once a study is on your phone you can read it, write your answers and use the answer check without a connection. You need internet only to download a new study, to update the app, to send a problem report, and to watch videos online.

### How do I get a study? [core]
A few studies are already in the app. To add another, tap the library icon (top left), then **Load Study**, and choose the `.estudy` file someone sent you. Studies you can download are listed under **Paths** in the Library.

### What are Basic, Intermediate and Advanced? [later]
They are three levels of the app's settings. **Basic** keeps things simple: reading and the essential display settings. **Intermediate** adds more options, such as the reading font, answer box size and the Library settings, and **Advanced** shows every setting. Change it at **Settings → App**; nothing you have written is affected.

---

## Answers and feedback

### Are my answers saved? Where? [core]
Yes, automatically. When you move away from an answer box, the app saves what you wrote. It is stored only on your phone, and each study keeps its own answers.

### What does the answer check do? What if it seems wrong? [core]
It is a quick check that works offline. It looks at the length of your answer and whether it uses the main ideas of the question and passage. It is a simple tool, not a person: sometimes it will say "well done" to a weak answer, and sometimes it will miss a good one. It is never a mark, and nobody sees it. If you are unsure, tap the **main point** button to compare your answer with it.

### It says my answer repeats the passage, but I wrote it myself. [core]
The check flags answers that use mostly the same words as the passage. Try saying the idea in your own words, as if explaining it to a friend. If you think your answer is good, move on: the check can be wrong.

### How do I turn the answer check on or off, or get hints? [later]
At **Settings → App** you can choose **Manual** (you tap the check icon when you want it) or **Auto** (it runs after you leave an answer box). The hint button and the main point button on a question card are always yours to use.

---

## Phones and backup

### What if I lose my phone or get a new one? [core]
Make a backup file now and keep it somewhere safe. At **Settings → Study → Backup**, save the file to Google Drive or send it to yourself in a message. On the new phone, open the file in the app (or **Settings → Study → Restore**) and your answers, notes and stars come back. The app reminds you if you have not made a backup for 30 days. ⚠ CHECK: also say whether Android's own Google backup restores automatically on a new phone (the What's New slide says it offers to).

### If I restore a backup, will I lose what I wrote since? [later]
No. Nothing on the phone is lost. Where an answer is in both, the newer one is kept.

### How do I delete a study? Do I lose my answers? [core]
In the Library, tap the bin icon on the study's card. This removes the study **and all your answers for it**, and it cannot be undone. Share, print or back up first if you want to keep them.

### I was sent a new version of a study. What do I do? [later]
Open the new file in the app, the same way as the first one. If it is newer, it is installed. If it is the same or older, the app asks what you want. ⚠ CHECK: confirm that your answers are kept when a newer version is installed (they are stored under the study's ID, so I expect yes, but I have not tested a version with changed questions).

---

## Sharing and groups

### How do I share or print my answers? [core]
At the bottom of a chapter, tap **Share** to send that chapter's answers by WhatsApp, email or any other app, or tap the print icon to print or save a PDF. To do every chapter at once, go to **Settings → Study** and use the share or print-all options. Your notes are included in Share and Export.

### What is a study group? What can my leader see? [core]
A leader creates a group in a study and shares an invite in the group's chat; members open it and type their name. Members send their progress to the leader whenever they choose, and each time they decide what to include: progress only, progress with answers to starred questions, or all their answers. Notes are never sent. There are no accounts and no server: the files travel by WhatsApp or similar, so send yours to the leader in a private message, not in the group chat.

---

## Privacy

### Who can see my answers? [core]
Only you, unless you share them. The app has no account, no adverts and no tracking, and it does not send your answers anywhere. The full policy is on the app's privacy page.

---

## When something is wrong

### A study will not open or will not download. [core]
Go to **Settings → Diagnostics**. It shows what the app can see, such as storage space and any study that could not be read. Tap **Report a problem**: it opens your email app with a report ready to send (nothing is sent until you press Send). The report has no answers or notes in it.

### The writing is too small or too big. [later]
At **Settings → App** use the text size controls. The app also follows your phone's own font size setting, so a very large phone setting can make some pages crowded.

### How do I change the language? [later]
At **Settings → Language** choose the language of the app's menus and buttons. This does not change the language of the study itself. Studies that come in more than one language have a language bar at the top of the chapter.

### I use an iPhone. Is my work safe? [later]
Use the web version and add it to your Home Screen (in Safari, tap Share, then **Add to Home Screen**). That lets it work offline and helps stop Safari clearing its storage. ⚠ CHECK: wording about Safari clearing storage. Either way, make a backup now and then.

### How do I contact you? [later]
Email bible.study.reader@gmail.com. If something is not working, use **Report a problem** in Settings → Diagnostics: it includes the details that help.

---

## Things to check before this goes into the app

1. **The privacy policy is out of date in three places.**
   - It says studies are downloaded from Google Drive. Commit b04949f moved this to the GitHub Pages download page, so section 3a, section 3b (if app updates also changed) and the third-party list (section 8) need review.
   - It says a study is deleted with "press and hold → Delete". In the code, a long press reorders studies and deletion is the bin icon on the card.
   - It says answers are cleared at "Settings → Answers". The button ("Clear all saved answers") is in **Settings → Study**.
   - Fix these before the FAQ links to the policy.
2. **Backup and Android Google backup.** Confirm what happens on a new phone before promising anything (see Phones and backup).
3. **iPhone.** The settings page says iOS is "coming soon", so the iPhone question is only about the web version. Decide whether to include it.
4. **The "Study" tab name.** It appears in both How to Use and Settings, so the FAQ always writes the full path (for example Settings → Study).
5. **Reading level.** I kept the sentences short. Tell me if any answer is still too complicated for your readers.
