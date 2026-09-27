# Linux operations guide

This guide covers the existing DM Workbench desktop prototype on Linux x64. It is a local, single-user application; there is no hosted service, system daemon, or production deployment in this repository.

For installation and tests, start with the [project README](../README.md). The full [desktop guide](desktop.md) and [user guide](guide.ru.md) are in Russian.

## Runtime and process ownership

```text
Electron main process
  ├─ sandboxed renderer, served through dmw://app/
  ├─ SQLite database + Markdown/audio files
  ├─ helper HTTP server on 127.0.0.1:<assigned port>
  └─ optional Ollama process on 127.0.0.1:11434
```

The main process starts the helper server on an OS-assigned port. The renderer uses a restricted IPC bridge for storage operations; it has no direct Node.js access. The assistant proxy accepts local model endpoints and checks request origins.

If Ollama is already available on port 11434, the application reuses it. Otherwise it attempts to start a local runtime and owns that child process. On exit it sends `SIGTERM` to the Ollama process it started and leaves an existing external service running. Switching AI directories uses a separate stop helper that escalates to `SIGKILL` after three seconds if needed. The main application remains usable when the model is unavailable.

Implementation: [desktop startup](../desktop/main.mjs), [runtime lifecycle](../scripts/ai-runtime.mjs), [assistant proxy](../scripts/local-assistant.mjs).

## Configuration and data locations

| Setting | Purpose | Default behavior |
| --- | --- | --- |
| `DMW_DATA_DIR` | Campaign library | `DM Workbench` in the system Documents directory, unless another library was selected |
| `DMW_USER_DATA_DIR` | Electron profile and settings | Electron's user-data directory |
| `DMW_AI_DIR` | Ollama runtime and models | Source launcher: `.local-ai/` in the project; packaged app: the configured AI directory or `local-ai/` in its profile |

To try the application with a separate library and profile, first close any running DM Workbench instance, then run from the source checkout:

```sh
dmw_demo_dir="$(mktemp -d -t dm-workbench-demo.XXXXXX)"
DMW_DATA_DIR="$dmw_demo_dir/library" \
DMW_USER_DATA_DIR="$dmw_demo_dir/profile" \
pnpm start
```

This creates temporary application data. Keep real campaigns in a persistent location. AI selection still follows `DMW_AI_DIR` and the existing local Ollama service.

The library contains:

```text
workbench.sqlite           # campaign state, indexes, and write journal
campaigns/<id>/notes/       # editable Markdown files
campaigns/<id>/audio/       # local audio assets
memory/                    # assistant preferences and conversation notes
backups/                   # automatic backups
.trash/                    # files removed by the application
```

Application binaries, user data, and model weights are separate. Replacing the application folder is not a data migration. Model weights and private campaign data are excluded from Git.

## Troubleshooting

Start from a terminal with `pnpm start` or, for a packaged build, `./start.sh` to see startup errors.

| Symptom | First checks | Relevant behavior |
| --- | --- | --- |
| Source launch fails | `node --version`, `pnpm --version`; confirm the Electron runtime was installed | Source setup requires Node.js 24+, pnpm 11, and the Electron download step |
| Assistant is unavailable | `curl --fail --max-time 3 http://127.0.0.1:11434/api/version` | A successful response confirms Ollama is reachable, not that a model is installed |
| Model is missing | `curl --fail --max-time 3 http://127.0.0.1:11434/api/tags` | Inspect the model list; use the app's AI setup if the required model is absent |
| Ollama does not start | Inspect `ollama.log` in the configured AI directory | Only app-managed Ollama output is written there; an externally managed service has its own logs |
| Port ownership is unclear | `ss -ltnp` | App-managed services bind to loopback; the helper port is dynamic |
| A save or backup fails | Check free space with `df -h` and library permissions with `ls -ld` | Keep the unsaved editor text while investigating the error |
| An external edit conflicts | Preserve the draft, refresh notes, then compare versions | Revision checks reject stale writes instead of silently replacing external changes |

If you manage Ollama separately with systemd, use that service's logs. The application itself does not install a systemd unit. Do not work around normal startup problems by disabling Electron's sandbox; the repository's CI exception is limited to isolated tests.

## Backup and recovery procedure

1. In **Хранилище** (Storage), choose **Сохранить полную копию** (Save full backup).
2. Save the resulting `.dmw-backup.json.gz` on a separate device or other independent storage.
3. Choose **Восстановить копию** (Restore backup) and select a destination for a new library.
4. Check campaign names, several Markdown notes, audio playback, and assistant memory. Close and reopen the restored library to check persistence.
5. Keep the original library until the restored copy has been checked.

The full backup includes campaigns, notes, audio, the assistant style profile, and Markdown memory. It excludes model weights, window settings, `.obsidian`, `.trash`, and internal revision history. Restoring creates a new folder and remaps campaign IDs.

Automatic backups are created when a nonempty library is opened, at most once per UTC day, keeping the latest 14. They are stored on the same disk. There is no periodic backup timer while the window stays open, so use the explicit export for a fresh copy before an update.

Do not copy only `workbench.sqlite` from a running application as a full backup: SQLite may also have WAL/SHM files, and campaign notes and audio live outside the database.

## Recovery checks and their limits

The [storage tests](../tests/desktop-storage.test.mjs) cover persistence across reopen, external Markdown changes, stale revisions, an interrupted file write, and restoration of a complete backup. Run them with:

```sh
node --test tests/desktop-storage.test.mjs
```

The interruption test injects a file-write failure after the database transaction, then reopens the store and checks recovery from the journal. It does not simulate a physical power loss or a full disk.

The [CI workflow](../.github/workflows/check.yml) additionally checks the browser, Electron restarts, and the packaged Linux binary. AI behavior in these checks uses a deterministic substitute; passing CI does not validate a downloaded model's response quality.

Current operational limits: no signed installer, automatic updater, central monitoring, remote multi-user service, or validated Windows/macOS package. These are prototype boundaries, not deployed features.
