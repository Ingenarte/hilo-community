# Timeline · Hilo deploys

User-facing changelog. One entry per push to `main` with a 1–2 line
summary of what changed for the people using the app.

Excluded: ticket data, user emails or names, internal refactors,
dependency bumps, tests, and sprint artefacts.

---

## 2026-10-28

- Dropdown lists (status filter and others) are now readable in dark mode on Windows.

## 2026-10-22

- A quieter, more polished look across the app: the inbox and the Queue are now one list with hairlines instead of a stack of floating cards, chat bubbles and panels sit flat on the page, and the whole interface uses the Inter typeface on every device.
- Buttons, inputs and dropdowns share one set of sizes and the brand colour; the primary button, badges and focus rings now follow the accent you choose in Preferences, in both the dark and the light theme.
- The top bar is simpler: Tickets, Queue and Gantt up front, every admin page under one "Admin" menu, and Preferences, Install and Sign out under your avatar.
- Ticket priority is a four-button switch in the side panel (Urgent, High, Normal, Low) instead of a dropdown, and the side panel is one card with sections instead of many small boxes. Dropdowns and checkboxes have a matching custom style.
- Counters, times and ticket numbers use regular text with aligned digits instead of a typewriter font. The reply box shows the keyboard shortcut next to the templates instead of inside the placeholder.

## 2026-10-14

- Passwords are no longer sent by email. New accounts, admin resets and "Forgot your password?" now email a one-time link where you choose your own password. The link works once and expires (1 hour for forgot-password, 24 hours for admin resets, 7 days for new accounts).
- "Forgot your password?" no longer changes your password until you use the link, so nobody else can lock you out by typing your email.
- Accounts that still have a temporary password must choose their own the first time they sign in. Everyone else sees a reminder with a "Change password" button, also available in Preferences.
- New passwords are checked: at least 8 characters, no very common passwords, and not known from public data breaches.
- Links in notification emails are more reliable. They are no longer used up when a mail program or antivirus previews them (opening one now shows a button to continue), and if a link has expired or you were signed out you go straight to the conversation after signing in, instead of landing on the inbox. This works for any page you open from an email or a bookmark.
- The inbox no longer lists closed tickets by default: it shows the active ones, and the status filter can show closed tickets or everything. A text search looks through all of them.
- Closed tickets no longer take replies from users: the reply box is replaced by a note with a button to open a new ticket, and only an administrator can reopen a closed ticket (an emailed reply gets an automatic explanation). Users can no longer edit or delete their messages in a closed ticket either. Admins can still write in a closed ticket.
- Admins can now select several tickets in the Queue (tick them one by one or "Select all") and act on all of them at once: close, extend their time (with a written reason), set the priority or export them. The inbox shares the same action bar, which also gained "Extend time".
- You can ask for more time on a ticket: an "Extend time" button in the ticket's side panel, and the countdown next to the ticket status (works on phones too), add 24, 48 or 72 hours. Like marking a ticket urgent, a written reason is required, and everyone on the ticket sees it.
- Admins can filter the inbox by user, next to the project filter.
- Deadline reminders by email, set up in Preferences: an alert before a ticket is due (24 hours by default, sent during your working hours), a daily summary of everything due in the next 24 hours, and a weekly summary of overdue tickets (Tuesday by default). Each one can be switched off, and you choose your time zone, working days and hours, and the day and time of each email. A button sends you a test email. Everyone gets them by default for the tickets they can see.
- Voice messages that contain no sound (for example a muted microphone) are now recognised: the chat says so instead of showing a player that seems broken, and while recording you get a warning if no sound is being picked up.
- The response time of a ticket (for example 72 hours) now restarts every time anyone sends a message in it, from either side, instead of counting from when the ticket was opened. Internal notes do not restart it, and a reopened ticket starts a fresh clock. Existing open tickets were recalculated from their last message.
- Fixed: voice messages recorded on Chrome, Edge, Firefox or Android now play on iPhone. They are converted to a format every device understands.
- Fixed: on phones, voice messages in the chat no longer stick out of their bubble.
- On phones the ticket header is more compact: the title gets its own full-width line and long lists of projects scroll sideways instead of stacking. With the phone turned sideways the reply box is reachable again.
- Every ticket opened from the inbox, the Queue or the Gantt now has previous and next arrows in its header (also on phones, and with the j and k keys) so you can move through the list without going back to it.
- Sign-in lockout now counts only wrong passwords (5 per hour per account). Normal sign-ins no longer count towards it: up to 20 per hour.
- The reply box on phones now looks and works like a chat app: a rounded text field with attach and camera inside, and one round button that is a microphone when the box is empty and a send arrow when you have typed something. Tap the microphone to record a voice message and tap the arrow to send it.
- Fixed: on phones, the reminder banners at the top (change your password, add a passkey) could push the reply box off the screen so you could only react with emojis. The chat now always fits what is above it, and those banners are shorter on small screens.
- Passkeys: sign in with your fingerprint, face or screen lock instead of a password. Add one from Preferences (or from the suggestion banner), and use "Sign in with a passkey" on the login screen. Your password keeps working as a backup, and an admin password reset also removes the person's passkeys.

## 2026-10-12

- Every ticket now has a back button at the top left, on phones, tablets and desktop, that returns you to where you came from: the inbox with your filters, the Queue or the Gantt view.
- New Gantt view: every open ticket as a bar from when it was opened to its response deadline, with a line marking today. Works on phones too.
- The Gantt view now uses the full screen width, shows at least 30 days ahead, and colors each bar by project, with a legend; overdue and due-soon tickets get a red or orange outline.
- The Queue and the Gantt view can be filtered by user and by project.
- Archived projects no longer appear when creating a new ticket.
- On screens narrower than a large desktop, the top navigation now lives in the menu so nothing is cut off on the right.

## 2026-10-11

- Every ticket now has a response target set by its priority: Urgent 24 hours, High 48 hours, Normal 72 hours (the default) and Low 96 hours. Pick it when you create a ticket, or change it any time from the ticket sidebar.
- Choosing Urgent asks for a short reason and a confirmation, and the reason is shown on the ticket.
- New Queue page in the top bar: every open ticket you can see, soonest deadline first, with the time left in red once it runs short or overdue.
- Export a ticket as Markdown, PDF or Word from the ticket sidebar. PDF and Word include the images; the Markdown export is a ZIP with the images and audio (and audio transcripts) when the ticket has attachments.
- Admins can select several tickets in the inbox and export them all at once as MD, PDF or DOCX.
- Fixed: an image opened right after a ticket loaded could close by itself a moment later.
- New "Generate agent token" button on every ticket (and in Preferences): a token valid for 96 hours that lets a coding agent such as Claude Code read the ticket with its images and audio, work on it and post a short reply. Agent replies are marked "agent", and you can revoke a token at any time.
- Fixed: hourly limits (such as the login lockout after 5 failed attempts) could reset after two minutes; they now hold for the full hour. Coding agents can post up to 20 replies per hour per token.
- Selecting tickets in the inbox no longer pushes the list down: the actions bar now floats at the bottom of the screen, so your pointer stays on the row you were clicking.

## 2026-10-10

- Images in tickets now open in a full-screen viewer on every device, including phones and the installed app, instead of a separate page. Close it with the X button, a tap outside the image, Escape, or the Back button.
- You can now zoom into images: pinch with two fingers, double-tap (or double-click), scroll the mouse wheel, or use the + and - buttons, then drag to move around.
- On phones, a back arrow now sits next to the logo in the top bar to return to your inbox from any other page.
- After sending a new ticket you now land back on your inbox instead of the ticket page.

## 2026-10-05

- Forgot your password? Use the new link on the sign-in page to get a fresh password emailed to you.
- Admins can now reset a user's password from the Users panel; the person gets a new password by email.
- Repeated failed sign-in attempts on the same account are now throttled to slow down guessing.

## 2026-08-09

- The landing-page presentation video now features a real presenter walking through all ten features, in sync with the animated chapters.
- Hilo now has a public landing page: visiting the site while signed out shows a presentation video, an overview of the ten headline features, and a link to the open-source project on GitHub. Signing in works exactly as before.
- Hilo is now open source — the code is published at github.com/Ingenarte/hilo-community for anyone to self-host.

## 2026-06-09

- Screenshots dragged from macOS now send correctly. You can also paste an image from the clipboard (Cmd+V / Ctrl+V) directly into a message — it joins the attachment list just like a dropped file.

## 2026-06-08

- You can now archive a ticket directly from the inbox — one click on the row icon, or tick multiple rows and use the bulk Archive button. Switch "Show archived" on to restore them.
- Inbox now shows a small eye icon on each ticket so admins can tell at a glance whether the user has seen your latest reply (green = seen, gray = awaiting).

## 2026-06-07

- The navbar unread badge now matches the count of unread tickets you see in the inbox — one number per ticket, not per message. The Next pagination button works even while the install guide is open.
- Inbox pagination Next/Prev navigate reliably. Admins now see the unread dot on every ticket their navbar count includes. Custom-named projects from users are immediately active — the legacy "pending" state has been retired.
- Unread tickets in the inbox now show a clear accent dot at the start of the row, so you can spot them at a glance even when the ticket also has a pending task on it.
- Email digest cap: you'll now get at most one email per day about unread ticket messages. In-app activity, push notifications, and other emails (task assignments, password changes) are unaffected.
- New tickets now send their attached files correctly — both the file-picker and drag-and-drop work. The "previous upload" reminder no longer appears in unrelated conversations.

## 2026-06-06

- Change your password from Preferences. New users now see a one-time install guide on first login so the app can be added to the home screen.
- New "?" help button in the navbar opens a step-by-step guide to install Hilo
  on iPhone, Android, Windows, or macOS — each with a short walkthrough video.
- On Windows and macOS the guide includes a copy-paste command that makes Hilo
  start automatically, minimized, when you sign in to your computer.
- Large uploads now survive page reloads without corrupting the file. Video downloads support in-browser seeking.
- You can now delete a user permanently from /admin/users (type their email to confirm). The active chip turns pastel green only when someone has logged in three days in a row from the same device. The Devices column now explains its 30-day window inline.

---

## 2026-06-05

- You can now send files up to 500 MB. Large attachments upload in the
  background with a progress bar so you can keep typing or even close the tab
  and come back. Pause and resume mid-upload is built in.
- Send voice messages directly from the composer. Tap the microphone button,
  record up to two minutes, and hit Stop to attach the audio to your message.
- Transcribe any voice message with one tap. Transcription runs locally on the
  Hilo server — your audio never leaves the host.
- Dictate messages with the speech-bubble mic button in the composer. Audio is
  transcribed locally on the Hilo server in rolling 20-second windows.

---

## 2026-06-04

- The "What's new" button in the navbar now uses a release-notes
  document icon. The previous bell glyph was easy to confuse with the
  per-message notification language used elsewhere in the app.
- Hovering a "Pending task" chip in the inbox now opens a styled
  popover with the full task title and description, so you can
  triage from the inbox without opening the ticket.
- Tasks assigned to you inside a ticket are marked with a bright
  "YOU" pill and an amber stripe down the left of the row.
- Pending tasks: inside a ticket the sidebar now lists tasks
  assigned to each participant. Admins and the ticket owner can add
  tasks (title + description, no dates); the assignee and admins can
  tick them as done. The inbox shows a warm amber stripe and a
  "Pending task" chip on every ticket that has at least one task
  open for you, and hovering the chip reveals the task title and
  description. Email + browser push notifications fire when a task
  is assigned.
- Inbox rows with unread messages now stand out with a violet accent
  stripe on the left and a subtle tinted background — readable across
  the room.
- A "What's new" bell in the navbar lights up after each deploy and
  drops down a short list of recent changes. A full /changelog page
  carries the long form.

## 2026-06-03

- WhatsApp-style read receipts under your last message: a single grey
  check for "sent · not read yet", a double cyan check with the
  reader's name and time for "read". Updates live when the other side
  opens the conversation.
- The composer textarea grows with the message you type, up to about
  40% of the visible chat height before scrolling internally.
- Image attachments render inline in the chat (tap to open full-size).
  Other files appear as a download chip — single tap saves them.
- Multi-line messages keep their formatting: paragraph breaks, lists
  and blank lines all survive the round-trip.

## 2026-05-31

- The admin overview shows which device class each person uses
  (mobile or desktop), highlighting the dominant one when it accounts
  for more than 50% of sessions in the last 30 days. Tap the chips
  for a per-OS, PWA and session-count breakdown.

## 2026-05-29

- The login page gained a (?) button with a short explanation of
  what Hilo is and how to request access. The misleading "Welcome
  back" eyebrow was dropped.

## 2026-05-28

- The sidebar drawer is readable again in light theme.
- iOS PWA keyboard fix: the composer stays glued to the keyboard with
  no gap, and the status bar no longer overlaps the navbar.
- Image attachments arriving by email also render in the chat (this
  used to silently fall back to the generic file icon).
- Tablet and phone admin views switched from a truncated table to a
  card layout.
- The notification-window dropdown now shows the selected value
  instead of looking blank.
- 403 pages explain "you don't have access" instead of pretending
  the server is broken.
- New admin screen to manage projects: list, create, rename and
  archive.
- PWA install: real maskable icons for Android and the manifest
  screenshots that were missing.

---

## How to add an entry

Before each push to `main` with a user-visible change, edit this
file:

1. Create a `## YYYY-MM-DD` section at the top if today's is missing.
2. Add a bullet, 1–2 lines, English, user-facing language.
3. Commit it together with the change.

Excluded: internal refactors, test cleanup, dependency bumps, sprint
artefacts, and any reference to real ticket ids, emails or user
names.
