---
name: harness
description: 本项目 AI 协作规范引导。当执行编码、修改代码、编写测试、重构、提交代码等开发任务时,先使用此技能加载项目约束。
---

执行任何开发类任务前,必须先依次读取以下文件并遵守其中约束:

1. 项目根目录的 `AGENTS.md`(项目概况、常用命令、架构说明与 Superpowers 规则)。
2. `.workbuddy/rules/编码风格.md`
3. `.workbuddy/rules/测试约定.md`
4. `.workbuddy/rules/提交规范.md`

规则之间冲突时以 rules 目录为准;规则未覆盖的事项反馈用户决策。
