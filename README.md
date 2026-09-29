# dsh-tool-suite

中文 | [English](README.en.md)

模型侧工具与宿主能力

## 包

| 目录 | 作用 |
|---|---|
| `dsh-wifi-access` | 移动端访问 host 侧：3081 反代 + query_wifi_access 工具 |
| `dsh-literature-search` | literature_search 工具：OpenAlex 按被引排序 + arXiv 按相关度 |
| `dsh-local-file-search` | @ 列表里的全机文件搜索，不进文件栏与工作区索引 |
| `dsh-hot-memory` | 把 Mnemon 的 USER.md / MEMORY.md 投影进每个会话的 systemPrompt |

## 装

```sh
# 只装其中一个包
dsh plugin --profile web add file:<本仓库>/dsh-wifi-access
```

整族一次装完（Windows PowerShell）：

```powershell
./install.ps1
```

不克隆仓库、直接从 Release 装（一行一个包）：

```sh
dsh plugin --profile web add "https://github.com/Ln1m/dsh-tool-suite/releases/download/v0.1.0/dsh-wifi-access-0.1.0.tgz"
dsh plugin --profile web add "https://github.com/Ln1m/dsh-tool-suite/releases/download/v0.1.0/dsh-literature-search-0.1.0.tgz"
dsh plugin --profile web add "https://github.com/Ln1m/dsh-tool-suite/releases/download/v0.1.0/dsh-local-file-search-0.1.0.tgz"
dsh plugin --profile web add "https://github.com/Ln1m/dsh-tool-suite/releases/download/v0.1.0/dsh-hot-memory-0.1.0.tgz"
```

装完重启 web 实例。每个包目录里还有它自己的 README。

## 界面

![dsh-local-file-search](dsh-local-file-search/assets/dsh-local-file-search.png)

## 许可

MIT
