# FaoRerm

A cross-platform SSH client built with Tauri, xterm.js, and russh.
## photo
<img width="1704" height="983" alt="图片" src="https://github.com/user-attachments/assets/dcb0bffe-8d48-4b43-ac36-7f92487647c7" />
<img width="1701" height="989" alt="图片" src="https://github.com/user-attachments/assets/9b88c6c6-aa0b-4502-a652-9756f4818030" />
<img width="1693" height="983" alt="图片" src="https://github.com/user-attachments/assets/2f199551-e52a-4276-91bb-189e98252af1" />
<img width="1690" height="985" alt="图片" src="https://github.com/user-attachments/assets/53d7d5b1-8540-429f-a594-6821d0390037" />

## Prerequisites

- [Rust](https://rustup.rs/) (latest stable)
- [Node.js](https://nodejs.org/) >= 18
- Platform build dependencies: [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

## Quick Start

```bash
npm install
npm run tauri dev
```

## Build

```bash
npm run tauri build
```

Bundles output to `src-tauri/target/release/bundle/`.

## Usage

### Master Password

On first launch, you'll be prompted to set a master password. This password encrypts all stored server credentials (AES-256-GCM). After a restart or after locking, enter this password to unlock the app.

- The lock screen appears automatically on launch if a master password is set.
- Press **`Ctrl+L`** at any time to manually lock the app when stepping away.
- The lock ensures all SSH credentials stay encrypted at rest.

### Server Management

In the left sidebar, click the **+** button to add a new server. You'll need to fill in:

| Field | Description |
|-------|-------------|
| Server Name | A friendly label (e.g., `production-web`) |
| Host | IP address or hostname |
| Port | SSH port (default 22) |
| Username | SSH login user (default `root`) |
| Auth Method | `Password` or `Private Key` |
| Password / Key Path | Password string, or path to a private key file (e.g., `/home/user/.ssh/id_ed25519`) |

Expand **Advanced Options** to configure inactivity timeout, keepalive interval, and whether to allow insecure algorithms.

- Click a server in the sidebar to connect.
- Hover and click the edit icon to modify a server's config.
- Click the delete icon to remove a server.

All server configs are stored as TOML in the platform config directory (`faoconfig.toml`).

### Terminal Tabs

Each SSH connection opens in a new tab at the top of the terminal area. You can have multiple sessions open simultaneously and switch between them. Close a tab to disconnect the session.

### Quick Commands

Open the command panel by clicking the right-edge toggle or pressing **`Ctrl+Shift+P`**.

Quick commands are preset command snippets that you can send to the active terminal with one click. Useful for frequently-used commands like restarting a service, checking logs, or navigating to a directory.

- Use `\n` in a command to send multiple lines (e.g., `cd /var/log\nls -la`).
- Add, edit, and delete commands from the panel or from the **Management** page.
- Commands are saved to the config file and persist across restarts.

### Zmodem File Transfer

FaoRerm supports Zmodem protocol for transferring files over an active SSH session. Just run `sz` (send/Zmodem download) or `rz` (receive/Zmodem upload) in the remote terminal:

- **`sz <filename>`** — triggers a save dialog to download files from the remote server to your local machine.
- **`rz`** — triggers a file picker; select local files to upload them to the remote server.

A progress bar appears above the terminal during transfers. Click the cancel button to abort.

### Command Blacklist

Go to **Management > Blacklist** to configure command patterns that are blocked from execution. Any command containing a blacklisted substring will be rejected before reaching the remote server.

- Add patterns like `rm -rf`, `shutdown`, or `DROP TABLE`.
- Blacklist entries apply globally to all servers.
- Each server config also supports a per-server `contains` list for server-specific filtering.

### Theme

Go to **Management > Settings** to switch between **System** (follows OS), **Dark**, and **Light** themes.

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **`Ctrl+L`** | Lock application |
| **`Ctrl+Shift+P`** | Toggle command panel |
| **`Ctrl+Shift+C`** | Copy terminal selection |

## Friendly Links

* [LINUX DO](https://linux.do) - An active Linux and technology community.

## License

[Apache 2.0](LICENSE)
