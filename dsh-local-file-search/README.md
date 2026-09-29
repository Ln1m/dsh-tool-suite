# dsh-local-file-search

> 本仓**只有 vk 版**：位置 —— 不占界面位置：往输入区 `@` 菜单加一条全机文件搜索，需先装 [dsh-vk-suite](https://github.com/Ln1m/dsh-vk-suite) 契约 + 骨架。
> 冲突：一个槽位只渲染优先级最高的一条，同优先级重复注册会直接抛错；与占同一位置的插件互斥（详见 [dsh-vk-suite](https://github.com/Ln1m/dsh-vk-suite) 的「推荐怎么用 / 会跟谁冲突」）。

[English](README.en.md) · 中文

![@ 菜单里的本机文件搜索界面实拍](assets/dsh-local-file-search.png)

*界面实拍：截自本机运行中的 DSH 实例，示例内容已脱敏。*

在对话框的 @ 列表里加一条「搜索本机文件」：全机一次性搜索。结果只进当前对话，不写进文件栏，也不进工作区索引。

## 装

```sh
dsh plugin --profile web add file:<本仓库>
```

装完重启 web 实例。
