# dsh-hot-memory

> **已归档（2026-09-28）**：面向本机的 Mnemon 补丁，不再维护。

[English](README.en.md) · 中文

把 Mnemon 的运行时记忆文件（`USER.md` / `MEMORY.md`）投影进每个会话的 systemPrompt，作为一个懒加载区段，不受 dsh-mnemon 生命周期门控影响。

## 装

```sh
dsh plugin --profile web add file:<本仓库>
```

装完重启 web 实例。

## 前提

- 需先装 dsh-mnemon：记忆文件由它维护，本插件只负责注入
