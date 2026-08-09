# Timeline · Hilo deploys

User-facing changelog. One entry per push to `main` with a 1–2 line
summary of what changed for the people using the app.

Excluded: ticket data, user emails or names, internal refactors,
dependency bumps, tests, and sprint artefacts.

---

## 2026-08-09

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
