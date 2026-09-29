# dsh-wifi-access

> **The vk build only**: position — claims no UI position: the 3081 reverse proxy (host half; the UI comes from third-party `dsh-pocket`); install the [dsh-vk-suite](https://github.com/Ln1m/dsh-vk-suite) contract + skeleton first.
> Conflicts: a slot renders only its highest-priority entry, and two registrations at the same priority throw; mutually exclusive with anything claiming the same position (see "How to use it / what it conflicts with" in [dsh-vk-suite](https://github.com/Ln1m/dsh-vk-suite)).

[中文](README.md) · English

The host-side implementation and standby for reaching your local DSH from a phone or tablet. **This plugin has no UI**: the "Mobile access" card in the Extensions tab (address / copy / QR code / LAN toggle / public tunnel) has been provided by `dsh-pocket` since 2026-09-25, because the two duplicated each other. This plugin keeps its host-side capabilities (it takes over 3081 when the other side drops).

**One rule for installation: install exactly one mobile access.** Prefer the password-protected third-party [`dsh-pocket`](https://github.com/shaobeichen/dsh-pocket) (at the cost of installing someone else's plugin); without it, install this one only (self-made, LAN reachable, zero third-party dependencies). Installing both makes them fight over port 3081.

Three things it provides that dsh-pocket does not:

| Capability | Detail |
|---|---|
| 3081 reverse proxy | Listens on `0.0.0.0:3081 → 127.0.0.1:3080`, rewrites Host/Origin back to loopback, and answers a bare navigation 401 with a 302 that swaps the token. It and dsh-pocket are mutual standbys: each re-probes every 20s and takes over when the other goes down |
| Mobile browser shim | Gaps measured on Huawei ArkWeb: `dsh-resource://` URL parsing, `Uint8Array.toHex/toBase64`, `Map.getOrInsertComputed`, `crypto.randomUUID`, and more |
| Routes and tool | `/wifi-access/api/status`, `/start`, `/stop`, `/qr`, `/client-caps`, plus the model-side `query_wifi_access` tool |

No changes to official code.

## Install

```sh
dsh plugin --profile web add file:<this repo>
```

Restart the web instance afterwards.

## Requirements

- Since DSH 0.1.6 `dsh web` can only bind to 127.0.0.1, so LAN access must go through the 3081 reverse proxy
- For a UI (address / QR code / start-stop / tunnel), install `dsh-pocket` as well
