# dsh-literature-search

> **The vk build only**: position — claims no UI position: a model-callable `literature_search` tool; install the [dsh-vk-suite](https://github.com/Ln1m/dsh-vk-suite) contract + skeleton first.
> Conflicts: a slot renders only its highest-priority entry, and two registrations at the same priority throw; mutually exclusive with anything claiming the same position (see "How to use it / what it conflicts with" in [dsh-vk-suite](https://github.com/Ln1m/dsh-vk-suite)).

[中文](README.md) · English

Adds a `literature_search` tool for the model: one structured call performs a literature search (OpenAlex sorted by citation count + arXiv by relevance) instead of reading a skill body and running a shell command.

## Install

```sh
dsh plugin --profile web add file:<this repo>
```

Restart the web instance afterwards.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `DSH_PAPER_SEARCH_SCRIPT` | `~/Research-Tools/paper-search.py` | Path to the backend script; you supply the script itself |

## Requirements

- A working `python` on this machine (the tool calls `python <script> <query> <limit>`)
