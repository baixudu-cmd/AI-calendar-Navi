# Navi 能力 API 文档

## 聚合 API

| API | 状态 | 入口 | 作用 | 主要副作用 |
| --- | --- | --- | --- | --- |
| `capability.registry` | implemented | `src/capability-api/index.ts` | 查询能力目录和单个能力合同 | 无副作用 |
| `assistant.core` | implemented | `src/capability-api/index.ts` | 处理单条用户消息；调用方只传本次消息，依赖由服务端固定 | 复用 `assistant.handle_message` 的副作用 |
| `runtime.operations` | implemented | `src/capability-api/index.ts` | 聚合做梦整理、主动早晚报、微信提醒派发、提醒队列查询 | 可写本地记忆、可发送微信、可更新提醒队列 |

这三个是给后续 AI 优先使用的入口。更细的 `model_tool.*` 和运行任务 API 仍保留在能力目录里，方便排错和扩展，但一般不需要直接穿透调用内部模块。

## 能力目录

| API | 状态 | 入口 | 作用 | 主要副作用 |
| --- | --- | --- | --- | --- |
| `capability.registry` | implemented | `src/capability-api/index.ts` | 查询当前能力 API 目录 | 无副作用 |
| `assistant.core` | implemented | `src/capability-api/index.ts` | 用户消息主能力 API | 复用 `assistant.handle_message` 的副作用 |
| `runtime.operations` | implemented | `src/capability-api/index.ts` | 运行任务聚合 API | 可写本地记忆、可发送微信、可更新提醒队列 |
| `assistant.handle_message` | implemented | `src/agent-api/index.ts` | 处理单条用户消息 | 可写日历、Seed Lite、短期状态、提醒队列 |
| `model_tool.calendar.create_event` | implemented | `src/tool-contract` | 创建单个明确日程 | 可写日历、可登记提醒 |
| `model_tool.calendar.create_reminder` | implemented | `src/tool-contract` | 创建某天某时的到点提醒 | 可写日历、可登记到点微信提醒 |
| `model_tool.calendar.create_events` | implemented | `src/tool-contract` | 批量创建 2 到 5 个日程；部分冲突时会列出本次尚未写入的其他事项 | 可写日历、可登记提醒 |
| `model_tool.calendar.create_and_propose_schedule` | implemented | `src/tool-contract` | 同一条消息里先创建明确日程，再为未定事项推荐时间 | 可写明确日程，可写 `pending_schedule`，待推荐事项确认前不写日历 |
| `model_tool.calendar.list_events` | implemented | `src/tool-contract` | 查询一天或一段日期日程 | 只读日历 |
| `model_tool.calendar.update_event` | implemented | `src/tool-contract` | 修改本地状态引用的日程 | 可写日历 |
| `model_tool.calendar.propose_schedule` | implemented | `src/tool-contract` | 推荐排程空档，可引用待推进目标，也可基于当前推荐重新推荐；回复会显示候选数量和确认边界 | 读 Seed Lite，写 `pending_schedule`，确认后才写日历 |
| `model_tool.calendar.confirm_schedule` | implemented | `src/tool-contract` | 确认、取消或修改推荐位 | 确认后可写日历 |
| `model_tool.assistant.remember_todo` | implemented | `src/tool-contract` | 记录待推进事项 | 可写 Seed Lite，可自动安排安全时间 |
| `model_tool.assistant.manage_todos` | implemented | `src/tool-contract` | 查看、完成、取消、修改待推进，支持批量完成 / 取消，也可记录提醒时间或关闭提醒 | 只改 Seed Lite，不写日历、不登记提醒队列 |
| `model_tool.calendar.delete_event` | implemented | `src/tool-contract` | 发起单个删除确认 | 写 `pending_delete` |
| `model_tool.calendar.delete_events` | implemented | `src/tool-contract` | 发起批量删除确认 | 写 `pending_delete` |
| `model_tool.calendar.confirm_delete` | implemented | `src/tool-contract` | 确认或取消删除 | 确认后可删日历 |
| `model_tool.calendar.confirm_create` | implemented | `src/tool-contract` | 确认或取消冲突后的创建 | 确认后可写日历 |
| `model_tool.calendar.daily_briefing` | implemented | `src/tool-contract` | 生成早报或晚报，并拉回待确认推荐等未处理上下文 | 只读日历、Seed Lite 和短期状态 |
| `model_tool.assistant.settings_summary` | implemented | `src/tool-contract` | 总结关键设置和修改入口 | 只读配置诊断，不暴露密钥原文 |
| `model_tool.assistant.status_overview` | implemented | `src/tool-contract` | 总结当前还挂着的待处理上下文 | 只读短期状态和 Seed Lite |
| `model_tool.assistant.dismiss_context` | implemented | `src/tool-contract` | 放弃当前挂起的短期上下文 | 只清理 pending 状态，不写日历、不删除待推进 |
| `model_tool.assistant.clarify` | implemented | `src/tool-contract` | 最少追问或保留创建草稿 | 可写 `pending_clarification` |
| `memory_dream.consolidate_daily` | implemented | `src/memory-dream/index.ts` | 每日本地记忆整理 | 可写本地 memory dream 文件 |
| `wechat_reminder.dispatch_due` | implemented | `src/wechat-reminder/index.ts` | 派发到点微信提醒 | 可发送微信、更新提醒队列 |
| `proactive.daily_briefing` | implemented | `src/live/proactive-briefing-cli.ts` | 主动早报和晚报 | 可只读主日历、可发送微信 |
| `runtime.self_use_doctor` | implemented | `src/live/self-use-runtime-doctor-cli.ts` | 自用运行体检 | 只读运行状态 |

## 错误情况

| 错误 | 含义 | 用户是否应感知 |
| --- | --- | --- |
| `entry_rejected` | 空消息、重复消息、超长消息等入口保护拒绝 | 是 |
| `model_rejected` | 模型输出未通过工具合同或动作合同 | 是 |
| `malformed_tool_call` | 模型没按 `toolName + arguments` 输出 | 否 |
| `unknown_tool` | 模型请求了未开放工具 | 否 |
| `missing_arguments` | 缺少必要参数 | 是 |
| `invalid_arguments` | 日期、时间、范围等参数不合法 | 是 |
| `guard_rejected` | 本地安全护栏拒绝执行 | 是 |
| `calendar_api_failed` | 日历执行层失败 | 是 |
| `feishu_api_failed` | 飞书 API 失败 | 是 |
| `state_target_missing` | 要改或删的本地目标不存在 | 是 |
| `todo_target_ambiguous` | 待推进目标匹配不到或匹配多个 | 是 |
| `no_schedule_candidate` | 没有待安排事项或空档 | 是 |
| `delivery_failed` | 微信发送失败 | 是 |
| `runtime_doctor_failed` | 发送前体检失败，停止发送 | 否 |
| `capability_not_found` | 请求的能力名不存在 | 否 |
| `store_write_failed` | 本地状态文件写入失败 | 否 |

## 实现状态

已实现：

- 能力目录：`src/capability-api/index.ts`
- 聚合 facade：`capability.registry`、`assistant.core`、`runtime.operations`
- 对齐测试：`tests/capability-api.test.ts`
- 主入口处理待推进编号续接前，会先把 Seed Lite 收件箱加载进短期状态。
- `calendar.propose_schedule.items[]` 可用 `target.itemNumber` 或 `target.itemNumbers` 引用待推进收件箱项；API Bridge 会先解析成标题和 `sourceIds`，再进入排程。
- `calendar.propose_schedule.preferredStartTime` 可表达新的推荐偏好；只有同时带 `contextRef: "pending_schedule"` 时，系统才复用当前推荐事项重新生成候选。
- `calendar.propose_schedule.preferredWindow` 可表达 `morning / afternoon / evening / later` 这类粗时段续接，避免把“下午/晚一点”塞进具体时间字符串。
- `calendar.propose_schedule.optionCount` 可表达用户想看 1 到 5 个候选；确认前只更新 `pending_schedule`，不写日历。
- `calendar.propose_schedule.contextRef` 目前只允许 `"pending_schedule"`，用于显式声明“本轮是在继续当前推荐”；没有这个字段时，旧推荐不会被自动复用。
- `calendar.create_event`、`calendar.create_events` 和 `calendar.create_and_propose_schedule.events[]` 必须带 `startTimeEvidence`，且该片段必须来自用户原文；证据比较会容忍空白和全角/半角差异，但不会把系统推荐时间当作用户原文时间；如果时间是系统推荐出来的，只能先走排程推荐，不能直接写日历。
- `calendar.create_reminder` 用于“某天某时提醒我做某事”的明确到点提醒；底层仍复用日历创建，但会登记 `leadMinutes: 0` 的微信提醒，不再把这类请求降级成待推进。若提醒时间来自 `state.seed_items[].reminderAt`，工具可带 `sourceIds` 引用收件箱事项；API Bridge 会在执行前核验收件箱时间，创建成功后才移除对应 Seed Lite。
- `calendar.create_and_propose_schedule` 可在一轮里处理“上午 10 点已有明确事项，下午还有未定事项”这类混合输入；明确事项成功写入后，未定事项会留下排程推荐上下文。
- `calendar.create_events` 遇到部分冲突时不会偷写其他日程，回复会同时列出冲突和本次尚未写入的其他事项，避免用户以为下午事项丢失。
- `calendar.daily_briefing` 会把 `pending_schedule` 等待处理上下文放进早晚报，让早晚报成为处理入口；主动早晚报 runner 也可只读展示待确认推荐。
- `assistant.settings_summary` 可在用户询问提醒时间、模型 API、日历写入、记忆文件或运行入口时，返回只读、脱敏的关键设置总结；它会读取 `.env` 的脱敏状态和 `config/settings.local.json` 的非密钥默认值，并展示追问策略、早晚报排程和确认前不写日历等低摩擦规则，不写日历、不写状态、不暴露密钥原文。
- `assistant.status_overview` 可在用户询问“你现在记着什么”“刚才那个还在吗”“还有哪些没处理”时，只读汇总待补时间、待确认推荐、待确认删除、冲突确认和待推进事项；它不访问日历、不写状态。
- `assistant.dismiss_context` 可在用户说“算了”“先不管了”这类放弃当前上下文时，清理待补时间、待确认推荐、待确认删除、冲突确认和图片草稿；它不访问日历、不写 Seed Lite。
- 两段路由实验已经从活跃源码中移除，不再出现在公共导出、能力目录或测试入口中；历史结论保留在旧阶段文档里。
- 能力目录只登记已实现能力；未验证或计划中的能力只能放在计划和评审文档里。

未纳入本阶段：

- 不新增正则、关键词路由或 prompt 例句补丁。
- 不新增后台读屏、截图、Trigger、多用户后台。
- 不恢复两段式模型路由作为真实微信入口默认链路。

## 后续 AI 调阅方式

后续 AI 要先读 `src/capability-api/index.ts`：

1. 先看 `apiName` 和 `implementationStatus`，确认能力是否稳定。
2. 再看 `sideEffects`，判断会不会写日历、发微信、改本地状态。
3. 再看 `failureModes`，失败时按统一错误口径处理。
4. 如果是处理用户消息，优先走 `assistant.core`。
5. 如果是后台运行任务，优先走 `runtime.operations`。
6. 如果要新增工具，必须同时更新 `src/tool-contract`、`src/capability-api/index.ts`、本文档和对齐测试。
