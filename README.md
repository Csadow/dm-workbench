# DM Workbench

**An offline desktop workspace for tabletop game masters, built for Linux.**

Plan sessions, manage campaign notes, run combat, and play local audio in one application. Campaigns stay on your device in SQLite, Markdown, and audio files. An optional local AI assistant runs through Ollama.

[![Checks](https://github.com/Csadow/dm-workbench/actions/workflows/check.yml/badge.svg)](https://github.com/Csadow/dm-workbench/actions/workflows/check.yml)

[Русское руководство](docs/guide.ru.md) · [Linux operations guide](docs/linux-operations.md) · [CI workflow](.github/workflows/check.yml)

**Status:** desktop prototype **0.7.2**, tested on **Linux x64**. The interface is in Russian. Windows and macOS builds have not been validated.

![Campaign knowledge workspace with linked Markdown notes and navigation](docs/images/knowledge-workspace.png)

*Built-in fictional demo data, shown in the browser compatibility mode that shares the desktop interface.*

## What it does

- Keeps multiple campaigns, linked Markdown notes, session plans, and an event journal.
- Tracks combat initiative, health, conditions, concentration, and undo history.
- Includes 330 creature stat blocks from the D&D SRD 5.2.1, with attribution in [THIRD_PARTY.md](THIRD_PARTY.md).
- Mixes local music, ambience, and sound effects.
- Exports and restores campaign data, notes, audio, and assistant memory.
- Uses an optional local Ollama model for suggestions grounded in the current campaign. Model weights are downloaded separately.

The desktop application works offline after installation. AI also works offline once its runtime and model are installed. No account or synchronization service is required.

## Engineering highlights

| Area | Implementation | Where to look |
| --- | --- | --- |
| Linux packaging | Portable Electron directory and `.tar.gz` build; application files are separate from user data | [Packaging script](scripts/package-desktop.mjs) |
| Continuous integration | GitHub Actions runs logic, browser, Electron restart, and packaged-binary checks on Ubuntu | [Workflow](.github/workflows/check.yml) |
| Persistent storage | SQLite plus Markdown/audio files; a journal completes pending file writes after a restart | [Storage](desktop/storage.mjs), [recovery tests](tests/desktop-storage.test.mjs) |
| Backups | Validated full-library export and restoration into a new folder; automatic backup retention | [Backup implementation](desktop/backup.mjs) |
| Local services | Loopback-only helper API and optional managed Ollama process | [Runtime lifecycle](scripts/ai-runtime.mjs), [operations guide](docs/linux-operations.md) |
| Desktop isolation | Sandboxed renderer, context isolation, and a restricted IPC bridge | [Main process](desktop/main.mjs), [preload](desktop/preload.cjs) |

## Run from source

Requirements: **Linux x64**, **Node.js 24+**, **pnpm 11**, and a graphical desktop session.

```sh
git clone https://github.com/Csadow/dm-workbench.git
cd dm-workbench
pnpm install --frozen-lockfile --ignore-scripts
node node_modules/electron/install.js
pnpm start
```

Dependency installation and the Electron download require internet access. Choose **«Открыть пример»** (Open example) for the fictional demo campaign.

The default library is `DM Workbench` in your system Documents directory. The **«Хранилище»** (Storage) screen lets you select another library and create or restore a backup. See the [operations guide](docs/linux-operations.md) for separate test profiles, configuration, and troubleshooting.

### Optional local AI

Use **«Скачать ИИ»** (Download AI) in the application or connect an existing runtime directory. The download needs `curl`, `tar`, `zstd`, and approximately 4.8 GB of network traffic; installed files require additional disk space. A running local Ollama instance can be reused. [AI setup and limits, in Russian](docs/local-assistant.md).

### Build a portable Linux package

```sh
pnpm package:linux
```

The build writes `dist/DM-Workbench-0.7.2-linux-x64/` and its `.tar.gz` archive. Run `./start.sh` inside the unpacked directory. Electron and Node are bundled; campaign data and AI model weights are not. Build from source using the commands above; a downloadable GitHub release is not currently published.

## Verify

```sh
# Logic, validation, SQLite, Markdown, recovery, and backup tests
pnpm test

# Browser regression checks; requires Chromium
pnpm test:browser

# Real Electron UI, import, backup/restore, and restart checks
pnpm test:desktop
```

If Chromium has another executable name, set it explicitly, for example:

```sh
CHROMIUM=google-chrome pnpm test:browser
```

Browser and desktop checks use temporary profiles and deterministic AI responses. The browser runner disables Chromium's sandbox for its isolated local test. The desktop runner requires a graphical session; CI uses Xvfb and an explicit test-only sandbox exception. Normal application startup keeps the renderer sandbox enabled.

To check a real installed model with Ollama running:

```sh
node scripts/test-local-ai.mjs
```

The [CI workflow](.github/workflows/check.yml) also builds and checks the standalone Linux binary. This does not test real model response quality or physical disk/power failures.

## Project layout

```text
app/          UI, campaign domain, combat, notes, audio, and assistant
assets/       Icon and attributed SRD creature data
desktop/      Electron main process, IPC, SQLite, files, and backups
scripts/      Local services, packaging, and integration checks
tests/        Node.js tests
docs/         Operations, architecture, design decisions, and user guides
.github/      Continuous integration
```

## Documentation and current limits

- [Linux operations guide](docs/linux-operations.md) — processes, configuration, logs, troubleshooting, and backup recovery.
- [Russian user guide](docs/guide.ru.md) — complete usage instructions, keyboard shortcuts, and browser-to-desktop migration.
- [Desktop architecture and storage](docs/desktop.md) — Russian.
- [Why Electron and file-backed storage](docs/adr/0002-desktop.md) — architecture decision, Russian.
- [Markdown notes and assistant memory](docs/knowledge-memory.md) — Russian.
- [Third-party data and attribution](THIRD_PARTY.md).

This is a local, single-user prototype. Signed installers, automatic updates, cloud synchronization, and validated Windows/macOS packages are not available. Automatic backups are stored on the same disk; keep an independent exported copy for device failure recovery. Real campaign data, local models, and backups are excluded from Git.
