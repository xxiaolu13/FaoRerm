# FaoRerm

A cross-platform SSH client built with [Tauri](https://tauri.app/) and [React](https://react.dev/). Terminal emulation powered by [xterm.js](https://xtermjs.org/), SSH protocol handled by [russh](https://github.com/RussianOtter/russh) — huge thanks to Eugene (RussianOtter) for this excellent Rust SSH implementation. Architecture inspired by [Warpgate](https://github.com/warp-tech/warpgate).

## Features

- **SSH connectivity** — password and private key authentication, host key verification, keyboard-interactive auth
- **Tabbed terminal** — multiple sessions in parallel with xterm.js + WebGL renderer
- **Zmodem transfers** — integrated upload/download support
- **Master password** — AES-256-GCM encrypted secrets, unlock once per session
- **Server management** — add, edit, delete server configs stored as TOML
- **Quick commands** — user-defined command presets with instant one-click send
- **Blacklist** — command-level filtering per server or globally
- **Theme switcher** — light, dark, follow system
- **Lock screen** — `Ctrl+L` to lock when stepping away

## Prerequisites

- [Rust](https://rustup.rs/) (latest stable)
- [Node.js](https://nodejs.org/) ≥ 18
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

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri v2 |
| Frontend | React 18, TypeScript, Vite |
| Terminal | xterm.js + addon-fit + addon-webgl |
| State | Zustand |
| SSH | russh 0.45 (Rust async SSH) |
| Crypto | AES-256-GCM, ChaCha20-Poly1305, bcrypt |
| Config | TOML (encrypted secrets) |

## Project Structure

```
src/                  # React frontend
  components/         # UI components
  stores/             # Zustand state stores
  hooks/              # React hooks (SSH events, terminal)
  terminal/           # xterm.js manager
src-tauri/
  src/
    main.rs           # Entry point
    lib.rs            # Tauri command handlers
    service.rs        # Config manager & session state
    client/           # SSH client (russh wrapper)
    enter/            # SSH connection, screen lock, CRUD commands
    zmodem.rs         # Zmodem protocol handling
```

## Acknowledgments

- [russh](https://github.com/RussianOtter/russh) by Eugene — the async Rust SSH library that makes this project possible
- [Warpgate](https://github.com/warp-tech/warpgate) — architectural reference for SSH session management
- [xterm.js](https://xtermjs.org/) — browser-based terminal emulation

## License

[Apache 2.0](LICENSE)
