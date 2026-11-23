# Contributing to Hubbub

Thanks for helping out! Bug reports, feature ideas and pull requests are all welcome.

## Getting started

```bash
npm install
npm run dev
```

Without access to a Nextcloud server, run the bundled mock server in another terminal:

```bash
npm run mock-server                                   # http://localhost:8686
PORT=8687 MOCK_NAME="Partner Cloud" npm run mock-server   # a second server
MOCK_CHATTY=1 npm run mock-server                     # Bob replies to your direct messages
```

Add the server in Hubbub with login `alice` and any app password. The browser login flow works too: the
mock login page has a **Grant access** button.

To keep your development data separate from an installed Hubbub, set a separate profile directory:

```bash
HUBBUB_USER_DATA=/tmp/hubbub-dev npm run dev
```

## Checks

Run these before opening a pull request. CI runs them too:

```bash
npm run lint
npm run typecheck
npm test
```

`npm run format` formats the code with Prettier.

## Architecture

```
src/
  main/       Electron main process: windows, menus, accounts, HTTP, auto-update
  preload/    The window.hubbub bridge between the UI and the main process
  renderer/   React UI
    api/        Typed wrapper around the Talk OCS API
    sync/       Polling engine (rooms, long-polling chat, notifications) and user actions
    store/      Zustand stores: app state (in memory) and preferences (localStorage)
    lib/        Pure helpers: message rendering, sidebar categories, themes (unit tested)
    components/ UI, laid out like Mattermost: server rail, sidebar, channel, right-hand panel, modals
  shared/     Types shared by main and renderer
scripts/      Mock server and icon generator
```

Key design points:

- **Credentials never reach the renderer.** The UI asks the main process to make a request for an
  `accountId` (`window.hubbub.ocs`). The main process adds authentication, and only allows paths on that
  account's own server. Each account uses its own Electron session, so cookies never mix between accounts.
- **Authenticated images** (avatars, file previews) are served through the `hubbub-media://` protocol,
  which the main process resolves with the account's credentials and caches in memory.
- **Sync:** the room list of every account is polled (every 10 s for the active server, 30 s for others).
  The open conversation, and the open thread, are long-polled the way the official Talk clients do it.
  Notifications are raised when the room list shows new messages in a conversation you are not looking at.
- **Feature detection:** use `hasFeature(account, 'threads')`, which reads the server's Talk capabilities.
  Always degrade gracefully on older servers.

## Taking screenshots

Development builds can capture a screenshot automatically, which is handy for UI changes and the README:

```bash
npm run build
HUBBUB_USER_DATA=/tmp/hubbub-dev HUBBUB_SCREENSHOT=/tmp/shot.png npx electron-vite preview --skipBuild
```

`HUBBUB_SCREENSHOT_JS` runs a snippet of JavaScript in the window before the capture (e.g. to click a
conversation), and `HUBBUB_SCREENSHOT_DELAY` sets the wait in milliseconds before it runs.

## Releasing

1. Update `CHANGELOG.md` and bump the version: `npm version 0.2.0 --no-git-tag-version`.
2. Commit, then tag and push: `git tag v0.2.0 && git push origin main v0.2.0`.
3. The **Release** workflow builds macOS, Windows and Linux installers and uploads them to a **draft**
   GitHub Release. Check the draft, add release notes, and publish it. Publishing is what makes
   auto-update pick it up.

### Code signing (optional, recommended)

Without these repository secrets the installers are built unsigned:

| Secret                                                  | Purpose                                                               |
| ------------------------------------------------------- | --------------------------------------------------------------------- |
| `MAC_CERTS`, `MAC_CERTS_PASSWORD`                       | Base64 "Developer ID Application" `.p12` certificate and its password |
| `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | App Store Connect API key for notarization                            |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`                  | Base64 Windows code-signing `.pfx` and its password                   |

Auto-update on macOS only works for signed builds: unsigned macOS builds are signed ad hoc (so Apple Silicon
will open them) and point the user to the release page when an update is out. Windows and the Linux AppImage
update without signing.

## License

Hubbub is licensed under the [Apache License 2.0](LICENSE). By submitting a contribution you agree that it is
licensed under the same terms (see section 5 of the license).
