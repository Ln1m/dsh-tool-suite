# dsh-wifi-access

[中文](README.md) · English

The host-side implementation and standby for reaching your local DSH from a phone or tablet. **This plugin has no UI**: the "Mobile access" card in the Extensions tab (address / copy / QR code / LAN toggle / public tunnel) has been provided by `dsh-pocket` since 2026-09-25, because the two duplicated each other. This plugin keeps its host-side capabilities; it can coexist with dsh-pocket, or stand alone as a 3081 reverse-proxy fallback.

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

## Slots reserved for LAN / public links

This plugin has no UI now and does not occupy the two slots below. If you also run `dsh-vk-suite`, they are reserved for link-style plugins:

| Reserved slot | Intended for |
|---|---|
| `vk.statusbar.left` | LAN links: local LAN access URLs, local service lists |
| `vk.statusbar.right` | Public links: tunnels / reverse proxies / share URLs |

Whoever implements it claims it, via `vkCard` — see the dsh-vk-suite README.
