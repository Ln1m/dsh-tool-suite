# dsh-tool-suite

[中文](README.md) | English

Model-facing tools and host capabilities

## Packages

| Directory | What it does |
|---|---|
| `dsh-wifi-access` | Host half of mobile access: reverse proxy on 3081 plus the query tool |
| `dsh-literature-search` | literature_search tool: OpenAlex by citation count, arXiv by relevance |
| `dsh-local-file-search` | Machine-wide file search from the @ menu, never enters the workspace index |
| `dsh-hot-memory` | Projects Mnemon USER.md / MEMORY.md into every session system prompt |
| `dsh-guard` | Local safety net: a checkpoint of changed files before every step, validation hooks, tool-call audit log |

## Release lines

| Release | DSH line | Notes |
|---|---|---|
| `v0.1.3` | 0.1.7 | This sync: right-column two-axis docking, plus this batch of skeleton and column changes |
| `v0.1.2` | 0.1.7 | Previous release of the 0.1.7 line |
| `v0.1.0` | 0.1.6 | Last release of the DSH 0.1.6 line; stays usable, no further updates |

## Install

```sh
# one package
dsh plugin --profile web add file:<this repo>/dsh-wifi-access
```

Or install the whole family on Windows PowerShell:

```powershell
./install.ps1
```

Install straight from the release, no clone needed:

```sh
dsh plugin --profile web add "https://github.com/Ln1m/dsh-tool-suite/releases/download/v0.1.3/dsh-wifi-access-0.1.0.tgz"
dsh plugin --profile web add "https://github.com/Ln1m/dsh-tool-suite/releases/download/v0.1.3/dsh-tool-literature-0.1.2.tgz"
dsh plugin --profile web add "https://github.com/Ln1m/dsh-tool-suite/releases/download/v0.1.3/dsh-local-file-search-0.1.2.tgz"
dsh plugin --profile web add "https://github.com/Ln1m/dsh-tool-suite/releases/download/v0.1.3/dsh-hot-memory-0.1.3.tgz"
dsh plugin --profile web add "https://github.com/Ln1m/dsh-tool-suite/releases/download/v0.1.3/dsh-guard-0.1.0.tgz"
```

If the install fails with `UNABLE_TO_VERIFY_LEAF_SIGNATURE` (a TLS-intercepting proxy; Node does not read the system CA store by default), run `$env:NODE_OPTIONS='--use-system-ca'` first.

Restart the web instance afterwards. Each package directory carries its own README.

## Screenshots

![dsh-local-file-search](dsh-local-file-search/assets/dsh-local-file-search.png)

## License

MIT
