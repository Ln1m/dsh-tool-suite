# dsh-hot-memory

> **Archived (2026-09-28)**: a local-only Mnemon patch, no longer maintained.

[中文](README.md) · English

Projects Mnemon's runtime memory files (`USER.md` / `MEMORY.md`) into every session's system prompt as one lazily loaded section, independent of the dsh-mnemon lifecycle gate.

## Install

```sh
dsh plugin --profile web add file:<this repo>
```

Restart the web instance afterwards.

## Requirements

- Install dsh-mnemon first: it maintains the memory files, this plugin only injects them
