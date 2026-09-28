# dsh-wifi-access

[English](README.en.md) · 中文

手机 / 平板访问本机 DSH 的 host 侧实现与热备。**本插件不提供界面**：功能栏那张「移动端访问」卡片（地址 / 复制 / 二维码 / 局域网开关 / 公网隧道）自 2026-09-25 起因功能重复改由 `dsh-pocket` 提供；本插件保留 host 侧能力，可与它共存，也可单独当 3081 反代的兜底。

它提供的是三件 dsh-pocket 没有的东西：

| 能力 | 说明 |
|---|---|
| 3081 反代 | 监听 `0.0.0.0:3081 → 127.0.0.1:3080`，把 Host/Origin 改写回 loopback，裸导航遇 401 自动 302 换 token；与 dsh-pocket 互为热备，每 20s 复探，对方掉线就自己接管 |
| 移动端浏览器垫片 | 华为 ArkWeb 实测缺口：`dsh-resource://` URL 解析、`Uint8Array.toHex/toBase64`、`Map.getOrInsertComputed`、`crypto.randomUUID` 等 |
| 路由与工具 | `/wifi-access/api/status`、`/start`、`/stop`、`/qr`、`/client-caps`，以及模型侧 `query_wifi_access` 工具 |

官方源码零改动。

## 装

```sh
dsh plugin --profile web add file:<本仓库>
```

装完重启 web 实例。

## 前提

- DSH 0.1.6 起 `dsh web` 只能绑 127.0.0.1，局域网访问必须经 3081 反代
- 想要界面（地址 / 二维码 / 启停 / 隧道）另装 `dsh-pocket`
