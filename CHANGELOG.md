# Changelog

All notable changes to Hubbub are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/tobberydberg/hubbub/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/tobberydberg/hubbub/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/tobberydberg/hubbub/releases/tag/v0.1.0
