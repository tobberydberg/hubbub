# Changelog

All notable changes to Hubbub are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Today**: a new first item in the sidebar with your day at a glance: the rest of today's meetings and
  tomorrow's, with Join; mentions and direct messages waiting for you and followed threads with new replies;
  invitations you haven't answered, with Yes, Maybe and No; the server's latest notifications; and your status
  and out-of-office at the top.
- **Notification center**: a bell in the header with everything Nextcloud notifies you about on the server,
  not only Talk (shares, calendar reminders, Deck, mentions in documents, …), with their own buttons, opening
  Talk links in Hubbub, and dismissing one or all (in Nextcloud too).
- **Out of office** (Nextcloud 28+), in the menu under your picture: the days you're away, a short and a long
  message and who to contact instead. Direct messages with someone who is away show it above the message box,
  and so do profile cards.
- **Share from Nextcloud Files**: the paperclip offers your Nextcloud files next to uploading from the
  computer. Browse your folders, pick one or more files and share them into the conversation (or thread),
  without downloading or uploading them again.
- **Shared items**: a button in the conversation header lists what was shared there, newest first: pictures
  and videos as a grid, files, voice messages, recordings, polls, locations and Deck cards, each with more on
  request and a way back to the message.
- **Contacts** from Nextcloud Contacts: they're suggested when you invite people to an event, people outside
  your server open a card with what your contacts say about them (company, title, emails, phones, address),
  and profile cards add the phone numbers you keep for a colleague.

## [0.5.0] - 2026-11-24

A calendar next to the chat, meeting invitations from Nextcloud Mail, your custom status, profile cards and link
previews.

### Added

- Calendar: each server has a chat and a calendar switch under its icon in the left rail. The calendar shows
  your Nextcloud calendars (the same ones, colors and sharing as Nextcloud Calendar) by day, week (Monday to
  Friday, or with the weekend), month or as an agenda for the next two weeks. Calendars can be hidden, and
  repeating events, invitations you haven't answered and all-day events show as in Nextcloud Calendar.
  Changes made elsewhere appear within half a minute.
- The event panel shows when and where, the reminders, who is invited and their answers, and for meetings
  with a Talk conversation **Join call** (with the call options) and **Open chat**.
- The next meeting with a call shows under the calendars, and from 10 minutes before it starts in the chat
  sidebar too, with Join.
- Answer invitations with Yes, Maybe or No in the event panel; Nextcloud tells the organizer.
- Create events with **New event** or by clicking a free time in the day or week view, and edit or delete your
  own: title, time or all day, repeat (daily, weekdays, weekly, monthly), calendar, place, reminder and
  description. Invite people of your server or anyone by email address; Nextcloud sends the invitations, the
  updates and the cancellations. **Add a Talk conversation** creates the meeting's conversation, with the
  invited people of your server in it, and links it to the event.
- Deleting one occurrence of a repeating event or the whole series. Edits to a repeating event apply to the
  whole series.
- Reminders from Nextcloud for your events show as desktop notifications; clicking one opens the event.
- Repeating events can repeat every N days, weeks, months or years: on chosen weekdays, on chosen days of the
  month or on, for example, the last Friday, in chosen months, and end never, after a number of times or on a
  date. A summary says it in words. Rules set elsewhere that Hubbub can't show are kept as they are.
- A default calendar for new events, per server, in Settings → Calendar.
- Web addresses in an event's place and description are links.
- Week numbers (ISO, Monday-first) in the small month, the week view and the month view, turned on in the new
  Settings → Calendar, which also has the weekends in the week view and the next-meeting strip.
- An event can be moved to another of your calendars, also after you've answered it: pick the calendar in the
  event panel or the edit dialog. Nobody is told, and the answers stay as they are.
- A repeating invitation can be answered for every occurrence or for just one.
- Invitations from Nextcloud Mail: meeting invitations that arrive in your Nextcloud Mail inbox (from
  Microsoft Teams, Outlook, Google and others) are added to your default calendar, once, and follow the
  organizer's updates and cancellations. The mails stay unread. Turned on per server in Settings → Calendar;
  works while Hubbub runs, checking the last 30 days of the inbox every 5 minutes (first fetching new mail into
  Nextcloud Mail, which otherwise may not have it yet).
- Invitations you haven't answered are listed in the calendar's sidebar, with Yes, Maybe and No, and counted on
  the calendar switch in the server rail. That includes invitations from colleagues on your server.
- Teams, Zoom, Google Meet and Webex meetings get a button to join them in the event panel.
- Your status: the menu under your picture has **Set a custom status**, a dialog like Nextcloud's own with
  Online, Away, Busy, Do not disturb and Invisible, a message with an emoji, suggestions (in a meeting, working
  remotely, out sick, vacationing, traveling, …) and when it clears (after 15 minutes up to this week, or at a
  chosen time). The menu shows your message and clears it with one click; `/status` sets it too.
- Profile cards: click someone's name or picture (in messages, @-mentions, the member list and event invitees)
  for their card: a bigger picture, title, company, email, phone, website and address as they share them in their
  Nextcloud profile, their status and message, their local time when it differs from yours, and when they were
  last active, with buttons to message or call them.
- Link previews: a message with a link shows a preview of the first one, with the site, the page's title,
  description and picture, like in Mattermost. Your Nextcloud server fetches the page (as for Talk on the web,
  which shows the same preview), so the site never sees you. Can be turned off in Settings → Display.
- The left sidebar can be made wider or narrower by dragging its edge; double-click for the default width.

## [0.4.0] - 2026-11-24

Call options with device checks, switching devices during calls, emoji by name, and macOS builds that keep
their permissions across updates.

### Added

- Emoji by name: type `:` and a couple of letters (`:thu`) for suggestions, pick with the arrow keys and
  Enter or Tab. A complete shortcode like `:tada:` or `:+1:` becomes the emoji.
- Emoticons become emoji as you type: `:-)` 🙂, `;)` 😉, `:D` 😃, `<3` ❤️ and more. Backspace right after
  brings the text back, nothing changes inside code, and it can be turned off in Settings → Advanced.
- Call options before starting or joining a call: pick camera, microphone and speaker, with a camera
  preview (blur included), a microphone level and a test sound; start muted or with the camera on; and
  choose how the call shows: in the sidebar, in the window or in its own window. The choices are kept, and
  the options can be turned off in Settings → Calls. Answering an incoming call still joins right away.
- During a call, the arrows next to the microphone and camera buttons switch microphone, speaker or camera
  (and blur), in the call view, its own window and the sidebar. Changing a device in Settings → Calls also
  applies to a running call.

### Changed

- macOS: Hubbub is signed with its own certificate instead of ad hoc. macOS now sees every version as the same
  app, so permissions like Screen Recording, the camera and the microphone are kept across updates (after
  updating to this version they have to be allowed once more). Updates are only installed when they are
  signed with the same certificate.

### Fixed

- Sharing your screen on macOS showed an empty list, without a word, when Screen Recording looked allowed but
  belonged to an earlier version of Hubbub. The picker now explains how to allow it again.
- "Check for Updates…" in the menu now always answers, in a dialog: up to date, downloading, ready to
  restart, or what went wrong.
- The message box no longer moves when "… is typing" appears or disappears under it.
- The microphone and camera chosen in Settings → Calls are actually used; calls took the system's default
  microphone before. If the chosen device is unplugged, the system's default is used.

## [0.3.0] - 2026-11-24

Polls, pinned messages, reminders, scheduled messages, meetings, typing indicators, slash commands and
background blur.

### Added

- Typing indicators: "Alice is typing…" under the message box, sent and shown the way Talk on the web does
  (works both ways with it). Hubbub now takes part in the conversation on screen like Talk on the web, and
  leaves it a minute after its window is hidden, so other devices are notified again.
- Slash commands: type `/` for suggestions. `/away`, `/online`, `/dnd`, `/offline`, `/status`, `/msg`, `/call`,
  `/invite`, `/kick`, `/join`, `/leave`, `/mute`, `/unmute`, `/header`, `/rename`, `/poll`, `/meeting`, `/me`,
  `/shrug`, `/code`, `/search`, `/settings` and `/help`. Unknown commands are sent as messages (for Talk bots); `//` sends a
  message starting with `/`.
- Polls: create one with the chart button in the message box or `/poll [question]` (single or several answers,
  results visible or hidden until it ends), vote and change your vote in the conversation, and end it.
- Read receipts on your own messages: ✓ sent, ✓✓ read by everyone, when the server shares read status.
- Pinned messages: pin from a message's menu for 24 hours, 7 days, 30 days or until unpinned (in direct
  messages, or as a moderator). The latest pin shows in a bar above the conversation, which you can hide for
  yourself.
- Remind me later: from a message's menu, in 20 minutes up to next Monday or at a time you pick. A desktop
  notification tells you when it's time, and "Upcoming reminders" in the account menu lists them.
- Send later: the arrow next to Send schedules a message, or sends it without a notification. "You have
  scheduled messages here" above the message box lists them, to send now, change the time or delete.
- Important conversations notify you even on Do not disturb, and sensitive ones hide the message text in
  notifications; both are in the conversation menu.
- Schedule a meeting from the conversation menu, the Info panel or `/meeting`: Talk puts it into the calendar
  you pick and invites the conversation's members (your Nextcloud account needs an email address for that).
  The Info panel lists the conversation's meetings this week.
- Background blur for your camera in calls: the sparkles button in the call view, or Settings → Calls. A
  segmentation model finds you in every frame, on your own computer, and the rest is blurred. The setting is
  kept for later calls.
- The side panel (threads, members, info, search) can be resized by dragging its edge, and the size is kept;
  double-click the edge for the default size.

### Changed

- In narrow conversations the message box hides strikethrough, quote and list buttons, so Send stays on the
  same line (the Markdown still works).

## [0.2.0] - 2026-11-24

Calls in Hubbub, group messages and in-app updates.

### Added

- Audio calls in Hubbub: start or join a call from the conversation header, with a call widget in the sidebar
  (who is in the call and speaking, mute, leave). Incoming calls ring and show Join / Decline; ringing can be
  turned off in the new Settings → Calls, which also has microphone and speaker selection. Calls need a server
  with the High-Performance Backend; encrypted and federated calls, and servers without it, open in the
  browser.
- Video calls: turn your camera on and off during a call, and open the call view for a video grid that
  sizes itself to the window and, in larger calls, keeps the people who are talking or have their camera on
  in view. Video is only downloaded while it is on screen. Camera selection in Settings → Calls.
- Screen sharing: share an entire screen or one window, picked with live previews. A shared screen takes the
  stage in the call view, with the participants in a row below it, and the sidebar shows who is sharing.
  Sound shared along with a screen (e.g. from a browser tab in Talk on the web) is played.
- Group messages: pick several people in "Direct Messages" for a conversation with all of them, listed under
  Direct Messages. Picking the same people again opens the existing one.
- "Start a call" in the + menu calls one or more people right away.
- Add people to a running call: ring conversation members who aren't in it, or add someone new (moderators;
  in a group message the new person's name is added to it). A one-to-one call moves to a group message with
  everyone, keeping your microphone, camera, screen share and the call view or window as they were.
- Switching to another call (e.g. joining one from its incoming call card) keeps your microphone, camera and
  call view; a screen share is not carried into a different call.
- Raise your hand and send emoji reactions in calls.
- Speaker view: the person talking large, everyone else in a row below; switch between grid and speaker in the
  call view.
- Simulcast: your camera is sent in three qualities and everyone receives the one that fits their tile, which
  keeps large video calls smooth.
- Incoming calls ring within a few seconds: Hubbub checks Nextcloud's notifications every few seconds (cheap,
  as nothing is sent when nothing changed) and refreshes right away when a call or mention comes in.
- Pop out a call into its own window and keep chatting in the main window. Closing that window puts the call
  back into the sidebar; it doesn't hang up.

- In-app updates everywhere: the unsigned macOS app now downloads and installs updates itself (checked against
  the release's checksums, swapped in when Hubbub quits or restarts), and Linux .deb and .rpm installs update
  from inside the app too (asking for the administrator password). Settings → About shows progress, a "What's
  new" link and Restart now; the banner can be dismissed until quitting.

### Fixed

- Linux: the app showed a generic icon. The packages now install the icon in all the sizes desktops look up
  (only 1024×1024 before), and the window is linked to its launcher entry
  (`io.github.tobberydberg.hubbub.desktop`).

## [0.1.0] - 2026-11-23

First release: a Mattermost-style desktop client for Nextcloud Talk on macOS, Windows and Linux.

### Added

- Multiple Nextcloud servers in a server rail, with unread and mention badges per server.
- Sidebar with Favorites, custom categories (synced via Talk conversation tags on Talk 24+), Channels
  and Direct Messages; drag-and-drop between categories; per-category sorting.
- Chat with Markdown, @mentions with autocomplete, emoji reactions, quote replies, editing and deleting.
- Collapsed reply threads (on by default, Settings → Display): replies only show in the thread panel, and the
  original message gets a footer with repliers, reply count, last reply time and a Follow button.
- Follow and unfollow threads. Native Talk threads (Talk 22+) store this on the server; reply chains are
  followed locally. You automatically follow threads you start, reply to or are mentioned in.
- A Threads view listing native threads and reply chains from your recent conversations, with unread markers,
  an Unreads tab and "Mark all as read".
- Meetings: conversations the Calendar creates for events (and instant meetings) get their own collapsed
  Meetings category with a calendar icon and the meeting time ("Now", "Tomorrow 10:00"). Upcoming meetings
  come first, running and soon-starting ones stay visible when collapsed, and past meetings are hidden after
  3 days (adjustable from the category's ⋮ menu). The conversation header shows the meeting's date and time.
- "Mark as meeting" / "Not a meeting" for meeting conversations Talk doesn't mark itself, such as calendar
  links created before Talk 21. Stored locally; these are never hidden as past meetings.
- Find Channels (Ctrl/⌘+K) across all servers, including people you don't have a direct message with yet,
  with All / Unread / Meetings filters (Tab cycles them).
- "Mark as unread" on any message (post menu, or Alt/⌥+click).
- File uploads (button, drag-and-drop, paste) with image previews.
- Message search, desktop notifications and dock/taskbar badges.
- Themes: Denim, Sapphire, Quartz, Indigo, Onyx, or follow the system.
- Right-click menu with spelling suggestions, "Add to dictionary", cut/copy/paste and link/image actions.
- Tray icon on Windows and Linux (with an unread dot); closing the window keeps Hubbub running there.
  Settings → Desktop: start at login, keep running in the background, check spelling.
- Login via the Nextcloud browser login flow; app passwords stored in the OS keychain. When an app password is
  revoked, Hubbub shows a notification, marks the server in the rail and offers "Sign in again".
- Servers with self-signed or company-internal certificates: review the certificate (issuer, validity,
  SHA-256 fingerprint) and trust exactly that certificate for that server.
- Drafts are kept across restarts.
- Update checks against GitHub Releases. Windows and the Linux AppImage update automatically; the unsigned
  macOS build links to the new release instead.

[Unreleased]: https://github.com/tobberydberg/hubbub/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/tobberydberg/hubbub/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/tobberydberg/hubbub/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/tobberydberg/hubbub/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/tobberydberg/hubbub/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/tobberydberg/hubbub/releases/tag/v0.1.0
