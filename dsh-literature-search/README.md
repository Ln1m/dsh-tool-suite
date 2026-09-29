# dsh-literature-search

> 本仓**只有 vk 版**：位置 —— 不占界面位置：模型可调用的 `literature_search` 工具，需先装 [dsh-vk-suite](https://github.com/Ln1m/dsh-vk-suite) 契约 + 骨架。
> 冲突：一个槽位只渲染优先级最高的一条，同优先级重复注册会直接抛错；与占同一位置的插件互斥（详见 [dsh-vk-suite](https://github.com/Ln1m/dsh-vk-suite) 的「推荐怎么用 / 会跟谁冲突」）。

[English](README.en.md) · 中文

给模型加一个 `literature_search` 工具：一次结构化调用完成文献检索（OpenAlex 按被引排序 + arXiv 按相关度），不必先读技能正文再跑 shell 命令。

## 装

```sh
dsh plugin --profile web add file:<本仓库>
```

装完重启 web 实例。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `DSH_PAPER_SEARCH_SCRIPT` | `~/Research-Tools/paper-search.py` | 后端脚本路径，脚本需自备 |

## 前提

- 本机 `python` 可用（工具用 `python <脚本> <关键词> <条数>` 调用）
