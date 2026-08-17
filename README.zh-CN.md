# Firstmate for DeepSeek Harness

> DeepSeek Harness 的 AI 大副。
>
> 一个大副，多个工人。你只管派活和验收。

[![CI](https://github.com/horizon0514/firstmate-dsh/actions/workflows/ci.yml/badge.svg)](https://github.com/horizon0514/firstmate-dsh/actions/workflows/ci.yml)

Firstmate 是面向 DeepSeek Harness（DSH）的 manager-centric 软件任务管理插件。你可以一次交代多个仓库中的任务；确定性代码负责准入、持久化、重试、恢复和打扰纪律，真正的工作由 DSH 原生可继续子 Agent 执行。

它不是终端墙，也不是多个 Agent 聊天窗口的集合。主界面是注意力收件箱，只在三种情况下打扰用户：需要决定、结果待验收，或安全恢复已经用尽而真正阻塞。

[English documentation](./README.md)

## MVP 能力

- 一次提交最多 20 个任务，每个任务包含工作区、目标、背景和验收标准。
- 不同规范化工作区可以并行；同一工作区的写任务严格串行。
- 默认将任务账本原子写入 `$DSH_HOME/firstmate/ledger.json`。
- DSH 重启后恢复活动任务，并在有限重试预算内处理无响应工人。
- 使用 DSH 原生 Agent、continuable Subagent、Session 持久化和生命周期事件。
- 主界面隐藏工人过程，验收包集中展示改动文件、Git 证据、测试、风险和未完成事项。
- 可以在 Firstmate 界面回答决策、接受结果、退回修改、重试或取消。

## 兼容性

MVP 仅对 **DeepSeek Harness `0.1.0-rc.6`** 做了精确验证。DSH 仍处于 developer preview，API 可能发生破坏性变化；Firstmate 已将所有 DSH 调用集中到 `firstmate-dsh` 适配层，但其他版本在验证前不受支持。

前置条件：

- Node.js `22.19+` 或 `24+`
- `PATH` 中可用 pnpm `10+`，供 `dsh plugin` 管理 profile
- DeepSeek Harness `0.1.0-rc.6`
- Git，用于收集验收证据

## 从 npm 安装

每个由维护者明确批准的 release 都会把同一份验证过的 tarball 发布到 npm 和 GitHub Releases。workflow 会先把打包产物安装到全新的 DSH Web profile 并完成冒烟，再对外发布。

```sh
dsh plugin --profile web add firstmate-dsh@0.1.0
dsh web --host 127.0.0.1 --port 3080
```

GitHub Releases 也提供 tarball 和 `SHA256SUMS`，可直接安装：

```sh
curl -LO https://github.com/horizon0514/firstmate-dsh/releases/download/v0.1.0/firstmate-dsh-0.1.0.tgz
curl -LO https://github.com/horizon0514/firstmate-dsh/releases/download/v0.1.0/SHA256SUMS
sha256sum -c SHA256SUMS

dsh plugin --profile web add ./firstmate-dsh-0.1.0.tgz
dsh web --host 127.0.0.1 --port 3080
```

macOS 的校验命令为 `shasum -a 256 -c SHA256SUMS`。

## 从源码安装

如需从 checkout 开发，请先构建，再加入 DSH Web profile：

```sh
git clone https://github.com/horizon0514/firstmate-dsh.git
cd firstmate-dsh
git checkout v0.1.0
npm ci
npm run build

dsh plugin --profile web add "$(pwd)"
dsh web --dump-config
dsh web --host 127.0.0.1 --port 3080
```

配置输出中应出现来自 `firstmate-dsh` 层的 `firstmate` 行。打开 `http://127.0.0.1:3080`，在侧边栏底部选择 **Firstmate**。

没有全局安装 DSH 时，可以使用精确版本：

```sh
npx --yes @deepseek-ai/dsh@0.1.0-rc.6 plugin --profile web add "$(pwd)"
npx --yes @deepseek-ai/dsh@0.1.0-rc.6 web --host 127.0.0.1 --port 3080
```

卸载命令：

```sh
dsh plugin --profile web remove firstmate-dsh
```

## 演示与验证

确定性演示使用 fake worker，不需要模型凭证，也不会产生模型费用：

```sh
npm run demo
```

它验证两个工作区并行、同工作区第二个任务排队、决策和验收进入注意力收件箱、验收后释放工作区，以及重启后仍保留待验收事项。

运行完整本地门禁和隔离的 DSH 安装/启动冒烟：

```sh
npm run gate
npm run smoke:dsh
```

`smoke:dsh` 会创建临时 `DSH_HOME`，安装当前 checkout，验证组合配置，以系统分配端口启动 Web，读取 Firstmate 客户端 bundle，调用严格校验的 Host Remote 快照接口，最后干净停止服务。

## 配置

默认值位于 [`cordis.patch.yml`](./cordis.patch.yml)。需要覆盖时，在 Web profile 的 `cordis.patch.yml` 中修改 `firstmate` 行：

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `stateFile` | `$DSH_HOME/firstmate/ledger.json` | 版本化持久任务账本 |
| `subagentProvider` | `spawn` | DSH continuable 子 Agent provider |
| `agentProvider` | DSH 默认值 | 可选的父 Agent / 工人 provider |
| `model` | DSH 默认值 | 可选的父 Agent / 工人模型 |
| `maxDepth` | `1` | 工人子 Agent 深度 |
| `maxRetries` | `1` | 进入 `blocked` 前的自动重试预算 |
| `staleAfterMs` | `900000` | 运行中工人的心跳超时 |

## 当前限制

- MVP 将所有任务视为写任务，尚未开放只读任务并行。
- 只支持手动创建任务。数据模型允许未来接入 GitHub Issue，但当前没有导入器。
- Host API 支持依赖关系，但 Web 输入框尚未提供依赖编辑。
- 工人完整过程保留在 DSH Session 中并默认隐藏；MVP 没有高级诊断入口。
- 账本是单机 JSON 文档，面向单个 DSH 进程，不提供分布式协调。
- 真实工人需要有效的 DSH 模型/provider 配置；测试、演示和冒烟不需要。
- Firstmate 运行时不会自动合并、部署、发布 npm 包或创建 Release；维护者明确批准的 tag 由 GitHub Actions 发布验证过的 npm 和 GitHub Release 产物。

## 详细文档

- [产品定位](./docs/product-vision.md)
- [架构](./docs/architecture.md)
- [任务生命周期](./docs/task-lifecycle.md)
- [开发指南](./docs/development.md)
- [路线图](./docs/roadmap.md)

## 许可证

[MIT](./LICENSE)
