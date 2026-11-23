# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Use
[GitHub private vulnerability reporting](https://github.com/tobberydberg/hubbub/security/advisories/new) instead.
You should get a response within a week.

## How Hubbub handles your credentials

- Hubbub signs in with Nextcloud's [Login Flow v2](https://docs.nextcloud.com/server/latest/developer_manual/client_apis/LoginFlow/index.html),
  which creates a dedicated **app password**. Your real password never reaches Hubbub.
- App passwords are encrypted with Electron's `safeStorage`, which uses the macOS Keychain, Windows DPAPI,
  or the Secret Service (GNOME Keyring / KWallet) on Linux. If no secret store is available on Linux,
  the password is stored base64-encoded only, and a warning is logged.
- Credentials stay in the main process. The UI (renderer) runs sandboxed with context isolation and can
  only ask the main process to make requests to the account's own server.
- Signing out of a server revokes its app password on the server.
- Links in messages always open in your default browser; the app never navigates away from its own UI.
