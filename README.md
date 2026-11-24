<p align="center">
  <img src="build/icon.png" width="96" alt="Hubbub icon" />
</p>

<h1 align="center">Hubbub</h1>

<p align="center">
  A Mattermost-style desktop client for <a href="https://nextcloud.com/talk/">Nextcloud Talk</a>, with multi-server support.<br/>
  macOS · Windows · Linux
</p>

![Hubbub with a thread open](docs/screenshots/threads-light.png)

## Features

- **Many servers, one app.** Add as many Nextcloud servers as you like. They appear in a server rail on the
  left with unread and mention badges, and you switch with <kbd>Ctrl/⌘</kbd>+<kbd>1…9</kbd>.
- **A familiar sidebar.** Favorites, your own categories, Channels and Direct Messages. Drag conversations
  between categories and sort each category alphabetically or by recent activity. Custom categories are
  stored on the server (Talk _conversation tags_) when available, so they match the Talk web app.
- **Threads.** Replies are collapsed into threads like in Mattermost, with a reply count under the original
  message. Follow threads, and see the ones you follow (including unread ones) in the **Threads** view.
- **Meetings.** Conversations the Calendar creates for events get their own Meetings category with the
  meeting time; past meetings tidy themselves away. You can mark other conversations as meetings too.
- **Group messages.** Direct messages with several people, listed under Direct Messages like in Mattermost
  (Talk's own way of adding people to a one-to-one conversation, so they work in Talk too).
- **Typing indicators.** "Alice is typing…" under the message box, in both directions with Talk on the web
  (when typing privacy in Talk's settings is public, and the server has the High-Performance Backend).
- **Slash commands.** Type `/` for the list: `/away`, `/dnd`, `/status`, `/msg @someone`, `/call`, `/invite`,
  `/join`, `/leave`, `/mute`, `/me`, `/shrug`, `/code`, `/search` and more. Unknown commands are sent as
  messages, so Talk bots still get them; start with `//` to send a message beginning with `/`.
- **Chat.** Markdown, code blocks, tables, @mentions and `:emoji:` with autocomplete, emoticons that turn into
  emoji (`:-)` → 🙂), emoji reactions, quote replies, editing (↑ edits your last message) and deleting. Read
  receipts (✓ sent, ✓✓ read by everyone) when the server shares read status.
- **Polls.** Create one from the message box or with `/poll`, with single or multiple answers and optionally
  hidden results; vote, change your vote and end it right in the conversation.
- **Pinned messages.** Pin a message for a while or until unpinned; it shows in a bar at the top of the
  conversation, which you can hide for yourself.
- **Remind me later** on any message, with a desktop notification when it's time and a list of upcoming
  reminders in the account menu.
- **Send later and silently.** The arrow next to Send schedules a message or sends it without notifying
  anyone. Scheduled messages can be sent now, moved or deleted.
- **Schedule a meeting** for a conversation into your Nextcloud calendar, inviting everyone in it; the Info
  panel shows the conversation's meetings this week.
- **Important and sensitive conversations.** Important ones notify you even on Do not disturb; sensitive
  ones hide the message text in notifications.
- **Resizable side panel** for threads, members, info and search (double-click the edge to reset).
- **Files.** Upload with the paperclip, drag and drop, or paste. Images show inline previews.
- **Find anything.** <kbd>Ctrl/⌘</kbd>+<kbd>K</kbd> jumps to any conversation or person on any server, with
  Unread and Meetings filters; the search bar searches messages.
- **Mark as unread** from any message (or <kbd>Alt</kbd>+click), and drafts are kept across restarts.
- **Calls.** Start or join an audio or video call from any conversation, or call several people at once
  from the + menu, after checking your camera, microphone and speaker (and choosing how the call shows).
  Switch devices during the call, share your entire screen or a single window, blur your background, raise
  your hand, send reactions and add people to a running call. A call widget in the sidebar shows who is talking; the call view
  shows everyone in a grid or the speaker large, and can pop out into its own window so you can keep chatting
  in the main one. Incoming calls ring within seconds, with Join and Decline. Works together with Talk on the
  web and on phones. Needs a server with the High-Performance Backend; other calls open in the browser.
- **Notifications.** Desktop notifications for direct messages and mentions, which respect each
  conversation's notification level, plus dock/taskbar badges.
- **Themes.** Denim, Sapphire, Quartz, Indigo and Onyx, or follow the system's light/dark setting.
- **Runs in the background.** Tray icon on Windows and Linux, and optional start at login.
- **Secure by default.** Browser-based login with app passwords stored in the OS keychain (see [SECURITY.md](SECURITY.md)).
  Servers with self-signed or company-internal certificates work after you review and trust the certificate.

![Onyx dark theme](docs/screenshots/channel-dark.png)

## Requirements

- A Nextcloud server with the **Talk** app enabled.
- Some features depend on your Talk version. Hubbub detects what your server supports:

| Feature                                     | Talk version                               |
| ------------------------------------------- | ------------------------------------------ |
| Chat, reactions, favorites, mentions, files | 15+                                        |
| Editing messages                            | 18+                                        |
| Threads and the Threads view                | 22+ (Nextcloud 32)                         |
| Server-synced custom categories             | 24+; older servers keep categories locally |

## Install

Download the installer for your system. The links always point to the latest release; older versions and
release notes are on the [Releases page](https://github.com/tobberydberg/hubbub/releases).

| Platform                            | Download                                                                                                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS, Apple Silicon (M1 and later) | [Hubbub-mac-arm64.dmg](https://github.com/tobberydberg/hubbub/releases/latest/download/Hubbub-mac-arm64.dmg)                                                                                                  |
| macOS, Intel                        | [Hubbub-mac-x64.dmg](https://github.com/tobberydberg/hubbub/releases/latest/download/Hubbub-mac-x64.dmg)                                                                                                      |
| Windows (x64)                       | [Hubbub-Setup-x64.exe](https://github.com/tobberydberg/hubbub/releases/latest/download/Hubbub-Setup-x64.exe)                                                                                                  |
| Windows (ARM)                       | [Hubbub-Setup-arm64.exe](https://github.com/tobberydberg/hubbub/releases/latest/download/Hubbub-Setup-arm64.exe)                                                                                              |
| Linux AppImage (x64 / ARM)          | [x86_64](https://github.com/tobberydberg/hubbub/releases/latest/download/Hubbub-linux-x86_64.AppImage) · [arm64](https://github.com/tobberydberg/hubbub/releases/latest/download/Hubbub-linux-arm64.AppImage) |
| Debian, Ubuntu (x64 / ARM)          | [amd64.deb](https://github.com/tobberydberg/hubbub/releases/latest/download/Hubbub-linux-amd64.deb) · [arm64.deb](https://github.com/tobberydberg/hubbub/releases/latest/download/Hubbub-linux-arm64.deb)     |
| Fedora, openSUSE (x64)              | [x86_64.rpm](https://github.com/tobberydberg/hubbub/releases/latest/download/Hubbub-linux-x86_64.rpm)                                                                                                         |

> **Not signed by Apple or Microsoft:** Hubbub has no paid code-signing certificate, so your system asks
> before running it the first time.
>
> - **macOS:** open Hubbub once and close the warning, then go to **System Settings → Privacy & Security**,
>   scroll down and click **Open Anyway** next to the message about Hubbub. (Or run
>   `xattr -dr com.apple.quarantine /Applications/Hubbub.app` in Terminal.) Hubbub is signed with its own
>   certificate, so macOS keeps permissions like Screen Recording across updates, and Hubbub only installs
>   updates signed with that same certificate.
> - **Windows:** choose **More info → Run anyway** in the SmartScreen prompt.

**Updates.** Hubbub checks GitHub for new versions on start and every few hours (or via Settings → About →
Check for updates), downloads them in the background and installs them when you click **Restart now** or quit:

- **macOS:** keep Hubbub in your Applications folder; when it runs from a disk image or straight from Downloads,
  it can only tell you that a new version is out.
- **Windows** and the **Linux AppImage:** fully automatic.
- **Linux .deb/.rpm:** installs on **Restart now** and asks for your password, like a package manager.

Then click **Add a server**, enter your Nextcloud address, and approve access in the browser window that opens.
If your server does not allow the browser login, use **Sign in with an app password instead** (create one under
_Personal settings → Security → Devices & sessions_).

## Keyboard shortcuts

| Shortcut                                        | Action                            |
| ----------------------------------------------- | --------------------------------- |
| <kbd>Ctrl/⌘</kbd>+<kbd>K</kbd>                  | Find a conversation on any server |
| <kbd>Ctrl/⌘</kbd>+<kbd>1…9</kbd>                | Switch server                     |
| <kbd>Alt</kbd>+<kbd>↑/↓</kbd>                   | Previous/next conversation        |
| <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>↑/↓</kbd>  | Previous/next unread conversation |
| <kbd>Ctrl/⌘</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> | Search messages                   |
| <kbd>Ctrl/⌘</kbd>+<kbd>N</kbd>                  | New direct message                |
| <kbd>↑</kbd> in an empty message box            | Edit your last message            |
| <kbd>Ctrl/⌘</kbd>+<kbd>,</kbd>                  | Settings                          |

## Not yet supported

- **Calls without the High-Performance Backend**, end-to-end encrypted calls and calls in federated
  conversations open in your browser.
- Voice messages and shared locations are shown as links or files, not as rich widgets.

## Development

You need Node.js 22.12 or newer.

```bash
npm install
npm run mock-server   # optional: a fake Talk server on http://localhost:8686 (login "alice", any password)
npm run dev           # start the app with hot reload
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the architecture, checks and release process.

## Privacy

Hubbub talks only to the Nextcloud servers you add, plus GitHub to check for updates. There is no telemetry or
analytics. Your app passwords are encrypted with the operating system's keychain (Electron `safeStorage`), and
signing out of a server revokes its app password. Drafts and preferences stay on your computer. On Linux,
Chromium downloads spell-check dictionaries from Google the first time they are needed; turn off
**Settings → Desktop → Check spelling** to avoid that.

## Disclaimer

Hubbub is an independent open-source project. It is not affiliated with or endorsed by Nextcloud GmbH or
Mattermost, Inc. "Nextcloud" and "Mattermost" are trademarks of their respective owners.

## License

[Apache License 2.0](LICENSE)
