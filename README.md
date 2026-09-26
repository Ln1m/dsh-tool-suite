# dsh-wifi-access

手机 / 平板访问本机 DSH。内置 WiFi 反代：`0.0.0.0:3081 → 127.0.0.1:3080`，把 Host/Origin 改写回 loopback，注入 `crypto.randomUUID` 与 Uint8Array 编解码 polyfill，裸导航遇 401 自动 302 换 token。左栏面板显示访问地址（可复制）与连接状态，一键启停。官方源码零改动。

## 装

```sh
dsh plugin --profile web add file:<本仓库>
```

## 前提

- DSH 0.1.6 起 `dsh web` 只能绑 127.0.0.1，局域网访问必须经本插件的 3081 反代

## 给局域网 / 公网链接留的位置

本插件走官方 sidebar 槽，不依赖三栏 layout，当前也不占下面这两个位。若你同时装了 `dsh-vk-suite`，那两个位是留着给链接类插件的：

| 预留位 | 用途 |
|---|---|
| `vk.statusbar.left` | 局域网链接：本机 LAN 访问地址、局域网服务清单 |
| `vk.statusbar.right` | 公网链接：隧道 / 反代 / 分享地址 |

谁实现谁填，用 `vkCard` 占位，见 dsh-vk-suite 的 README。