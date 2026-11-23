# Changelog

All notable changes to Hubbub are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/tobberydberg/hubbub/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/tobberydberg/hubbub/releases/tag/v0.1.0
