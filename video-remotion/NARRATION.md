# Promo narration script (for HeyGen)

English narration for the `Promo` composition (1920×1080, 30 fps, ~2:46 total).
Record the WHOLE script as ONE continuous HeyGen avatar clip (portrait
1080×1920) and export it as `public/heygen/narration.mp4` (+ its SRT as
`narration.srt`). The avatar plays in a persistent right-side panel while the
animated chapters run on the left. Scene switch times in
`src/compositions/Promo/data.ts` are derived from the SRT chapter start
timestamps — if you re-record, update the `T` table there from the new SRT.

Speaking pace assumed: ~140 words/min. Each block is written to fit its slot
with ~1 s of breathing room.

---

## Intro — 15 s (avatar on camera → `public/heygen/intro.mp4`)

> Hi — let me show you Hilo. It's a self-hosted ticket and chat platform for
> small teams: all the support tooling you actually need, running on your own
> server, with none of the SaaS overhead. Here are ten things it does really
> well.

## 01 · Threaded tickets, realtime chat — 14 s

> Everything starts with a ticket. Each topic gets one thread, and the
> conversation flows like modern chat — live updates over server-sent events,
> typing indicators, reactions, and message editing. No refresh button, no
> lost context.

## 02 · Voice, transcribed on your hardware — 14 s

> Sometimes typing is too slow. Record a voice note up to two minutes, and
> transcribe it with one tap — powered by a Whisper engine that runs on your
> own server. There's even dictation mode: speak, and the text lands straight
> in the composer.

## 03 · Files that actually arrive — 13 s

> Attachments go up to five hundred megabytes, in resumable chunks. Lose your
> connection, reload the page — the upload picks up right where it left off.
> Images render inline, and videos are seekable in the browser.

## 04 · Know what was seen — 12 s

> Hilo tells you what's been read. Grey check: sent. Cyan double-check: read —
> with the reader's name and time. And in the inbox, a single glance shows
> whether the user has seen your latest reply.

## 05 · Tasks inside the conversation — 12 s

> Conversations produce work, so tasks live right inside the ticket. Create
> one, assign it to any participant, and track it from the inbox. Tick it
> done, and everyone sees it — instantly.

## 06 · Email that works both ways — 14 s

> Every reply can notify by email — a rich, themed message with a magic link
> that signs you in and drops you exactly on the conversation. No password
> typed. And it works the other way too: an inbound email becomes a ticket
> automatically.

## 07 · Notifications on your terms — 12 s

> Web push notifications reach you on desktop and mobile, even with the tab
> closed. Set quiet hours and Hilo respects them, and digest throttling means
> you're never spammed — one summary per day, maximum.

## 08 · Built for operators — 13 s

> Under the hood, it's built for operators. Projects and groups control who
> sees what. Every action lands in an audit log. Webhooks push events to Slack
> or Discord, and a metrics endpoint keeps Prometheus happy.

## 09 · Installs like a native app — 12 s

> Hilo installs like a native app on iOS, Android, Windows, and macOS — with
> built-in guided videos for every platform. Dark and light themes, four
> accent colors, and it remembers each user's choice.

## 10 · Find it, export it, wire it up — 10 s

> And nothing gets lost: full-text search across every message, CSV export
> for any ticket or the whole workspace, and canned templates for the answers
> you type every day.

## Outro — 15 s (avatar on camera → `public/heygen/outro.mp4`)

> Best of all — Hilo is free and open source, MIT-licensed. Clone the repo,
> run docker compose up, and own your support stack in minutes. The link is
> right here: github.com/Ingenarte/hilo-community. See you in the issues!
