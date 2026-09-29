# dsh-wifi-access

> 本仓**只有 vk 版**：位置 —— 不占界面位置：3081 反代（host 半，界面由第三方 `dsh-pocket` 提供），需先装 [dsh-vk-suite](https://github.com/Ln1m/dsh-vk-suite) 契约 + 骨架。
> 冲突：一个槽位只渲染优先级最高的一条，同优先级重复注册会直接抛错；与占同一位置的插件互斥（详见 [dsh-vk-suite](https://github.com/Ln1m/dsh-vk-suite) 的「推荐怎么用 / 会跟谁冲突」）。

[English](README.en.md) · 中文

手机 / 平板访问本机 DSH 的 host 侧实现与热备。**本插件不提供界面**：功能栏那张「移动端访问」卡片（地址 / 复制 / 二维码 / 局域网开关 / 公网隧道）自 2026-09-25 起因功能重复改由 `dsh-pocket` 提供；本插件保留 host 侧能力（对方掉线时接管 3081）。

**装法只有一条规则：移动端访问只装一个。**优先装带口令的第三方 [`dsh-pocket`](https://github.com/shaobeichen/dsh-pocket)（代价是要连它一起装）；不装它，就只装本仓（自研，局域网可达、零第三方依赖）。两个都装会互相抢 3081 端口。

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
