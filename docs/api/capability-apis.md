# Navi 能力 API 文档

## 聚合 API

| API | 状态 | 入口 | 作用 | 主要副作用 |
| --- | --- | --- | --- | --- |
| `capability.registry` | implemented | `src/capability-api/index.ts` | 查询能力目录和单个能力合同 | 无副作用 |
| `assistant.core` | implemented | `src/capability-api/index.ts` | 处理单条用户消息；调用方只传本次消息，依赖由服务端固定 | 复用 `assistant.handle_message` 的副作用 |
| `runtime.operations` | implemented | `src/capability-api/index.ts` | 聚合记忆整理、主动早晚报、微信提醒派发、提醒队列查询 | 可写本地记忆、可发送微信、可更新提醒队列 |

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
| `model_tool.calendar.update_event` | implemented | `src/tool-contract` | 修改本地状态引用的日程，支持刚展示日程编号，或按结构化日期、时间段、标题查找唯一日程后修改 | 可写日历；可刷新对应未发送微信提醒 |
| `model_tool.calendar.propose_schedule` | implemented | `src/tool-contract` | 推荐排程空档，可引用待推进目标，也可基于当前推荐重新推荐；回复会显示候选数量和确认边界 | 读 Seed Lite，写 `pending_schedule`，确认后才写日历 |
| `model_tool.calendar.confirm_schedule` | implemented | `src/tool-contract` | 确认、取消或修改推荐位 | 确认后可写日历 |
| `model_tool.assistant.remember_todo` | implemented | `src/tool-contract` | 记录待推进事项 | 可写 Seed Lite，可自动安排安全时间 |
| `model_tool.assistant.manage_todos` | implemented | `src/tool-contract` | 查看、完成、取消、搁置、查看搁置区、恢复、修改待推进，支持批量完成 / 取消，也可记录提醒时间或关闭提醒 | 只改 Seed Lite，不写日历、不登记提醒队列 |
| `model_tool.calendar.delete_event` | implemented | `src/tool-contract` | 发起单个删除确认；支持刚展示日程编号，也可按结构化日期、时间段、标题查找候选 | 写 `pending_delete` |
| `model_tool.calendar.delete_events` | implemented | `src/tool-contract` | 发起批量删除确认 | 写 `pending_delete` |
| `model_tool.calendar.confirm_delete` | implemented | `src/tool-contract` | 确认或取消删除 | 确认后可删日历，并取消对应未发送微信提醒 |
| `model_tool.calendar.confirm_create` | implemented | `src/tool-contract` | 确认或取消冲突后的创建 | 确认后可写日历 |
| `model_tool.calendar.daily_briefing` | implemented | `src/tool-contract` | 生成早报或晚报，并通过 Watchlist 工作台拉回待处理上下文 | 读日历；可更新 Seed Lite 拉回次数、搁置状态和分组 Watchlist 短期状态 |
| `model_tool.assistant.settings_summary` | implemented | `src/tool-contract` | 总结关键设置和修改入口 | 只读配置诊断，不暴露密钥原文 |
| `model_tool.assistant.status_overview` | implemented | `src/tool-contract` | 总结当前还挂着的待处理上下文，并给出自然下一步 | 只读短期状态和 Seed Lite，会同步 `state.seed_items` 供后续编号续接 |
| `model_tool.assistant.dismiss_context` | implemented | `src/tool-contract` | 放弃当前挂起的短期上下文 | 只清理 pending 状态，不写日历、不删除待推进 |
| `model_tool.assistant.clarify` | implemented | `src/tool-contract` | 最少追问或保留创建草稿 | 可写 `pending_clarification` |
| `memory_dream.consolidate_daily` | implemented | `src/memory-dream/index.ts` | 每日本地记忆整理 | 可写本地 memory dream 文件 |
| `wechat_reminder.dispatch_due` | implemented | `src/wechat-reminder/index.ts` | 派发到点微信提醒 | 可发送微信、更新提醒队列；同一标题、时间和提前量只发送一条活跃提醒；发送文案按实际剩余分钟展示 |
| `proactive.daily_briefing` | implemented | `src/live/proactive-briefing-cli.ts` | 主动早报和晚报 | 可读主日历、更新 Seed Lite 拉回生命周期、发送微信 |
| `runtime.self_use_doctor` | implemented | `src/live/self-use-runtime-doctor-cli.ts` | 运行体检 | 只读运行状态 |

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
- `calendar.propose_schedule.items[]` 可用 `target.itemNumber`、`target.itemNumbers` 或 `target.group` 引用待推进收件箱项；`group` 支持 `pending_schedule`、`pending_reminder`、`pending_todo`、`all`。API Bridge 会先解析成标题和 `sourceIds`，再进入排程。
- `calendar.propose_schedule.preferredStartTime` 可表达新的推荐偏好；只有同时带 `contextRef: "pending_schedule"` 时，系统才复用当前推荐事项重新生成候选。
- `calendar.propose_schedule.preferredWindow` 可表达 `morning / afternoon / evening / later` 这类粗时段续接，避免把“下午/晚一点”塞进具体时间字符串。
- `calendar.propose_schedule.optionCount` 可表达用户想看 1 到 5 个候选；确认前只更新 `pending_schedule`，不写日历。
- `calendar.propose_schedule.contextRef` 目前只允许 `"pending_schedule"`，用于显式声明“本轮是在继续当前推荐”；没有这个字段时，旧推荐不会被自动复用。
- `calendar.create_event`、`calendar.create_events` 和 `calendar.create_and_propose_schedule.events[]` 必须带 `startTimeEvidence`，且该片段必须来自用户原文；证据比较会容忍空白和全角/半角差异，但不会把系统推荐时间当作用户原文时间；如果时间是系统推荐出来的，只能先走排程推荐，不能直接写日历。新建飞书日程未显式传提醒时，会默认写入 40 分钟原生提醒；用户明确不用提醒时传 `reminderMinutes: 0`，飞书提醒和微信提醒都会关闭。
- `startTimeEvidence` 还必须能对应结构化 `startTime`。例如用户只说“明天和产品聊一下”时，模型不能用“明天”作为 `09:00` 的开始时间证据；应转为追问或排程推荐。
- `calendar.update_event` / `calendar.delete_event` 的 `target` 可使用 `recent_event_item` 或 `event_query`。`recent_event_item` 用于刚展示或刚批量创建的日程编号；`event_query` 字段包括 `date`、`range`、`startTime`、`timeWindow`、`title`。这不是本地语义路由：语义仍由模型转换成结构化字段，本地只查找日历或短期状态；修改必须唯一匹配，删除匹配多个时只列候选并要求选择第几个。
- `calendar.update_event` 成功后会核对飞书返回结果是否体现了本次标题或时间修改；未体现时失败关闭，不更新短期状态或微信提醒队列。只改开始时间时，执行层会补齐结束时间后再写飞书，优先保持原日程时长，查不到原结束时间时默认 1 小时。核对通过后会刷新该 eventId 的未发送微信提醒：用户显式改提前量时按新提前量登记；只改日程时间时，若队列里原本已有未发送提醒，则沿用原提前量并移动到新时间。
- `calendar.update_event.patch.reminderMinutes: 0` 表示关闭提醒；飞书 payload 会发送 `reminders: []`，本地微信提醒队列也会取消对应未发送任务。
- `reminderMinutes` 可以是数字或数字数组；数组用于“重要事项再提醒一次”这类多提醒场景。合同层、飞书 mapper 和微信提醒队列都会去重、按提前量从大到小排序，并最多保留 3 个提醒点。
- `calendar.create_reminder` 用于“某天某时提醒我做某事”的明确到点提醒；底层仍复用日历创建，但会登记 `leadMinutes: 0` 的微信提醒，不再把这类请求降级成待推进。若提醒时间来自 `state.seed_items[].reminderAt`，工具可带 `sourceIds` 引用收件箱事项；API Bridge 会在执行前核验收件箱时间，创建成功后才移除对应 Seed Lite。
- `calendar.confirm_delete` 成功删除日程后，会取消提醒队列里该 eventId 的未发送和失败待重试任务；已发送任务只保留历史，不会再次派发。
- `calendar.create_and_propose_schedule` 可在一轮里处理“上午 10 点已有明确事项，下午还有未定事项”这类混合输入；明确事项成功写入后，未定事项会留下排程推荐上下文。
- `calendar.create_events` 遇到部分冲突时不会偷写其他日程，回复会同时列出冲突和本次尚未写入的其他事项，避免用户以为下午事项丢失。
- `calendar.daily_briefing` 会复用 `status-overview` 的 Watchlist summary，把 `pending_schedule`、待推进、待提醒等上下文放进早晚报，让早晚报成为处理入口；手动早晚报会同步分组 Watchlist 短期状态，主动早晚报 runner 也复用同一套工作台文案。
- `calendar.daily_briefing` 和 `calendar.list_events(date)` 写入 `briefing_items` / `recent_event_items` 时，会保留本次查询的目标日期；即使外部日历事件只返回 `HH:mm`，用户后续按“第几个 / 下午 4 点那个”修改时间，也能用结构化日期生成真实更新 payload。
- `calendar.confirm_schedule.itemChanges[].reminderMinutes` 会在确认推荐时覆盖单事项提醒；它同样支持最多 3 个提醒点。如果用户关闭、调整或增加多提醒，这个选择会作为 Memory Dream 的排程纠错信号保存，后续只在候选事项没有显式提醒时作为默认提醒使用，不会自动写日历。
- `assistant.settings_summary` 可在用户询问提醒时间、模型 API、日历写入、记忆文件或运行入口时，返回只读、脱敏的关键设置总结；它会读取 `.env` 的脱敏状态和 `config/settings.local.json` 的非密钥默认值，并展示追问策略、早晚报排程和确认前不写日历等低摩擦规则，不写日历、不写状态、不暴露密钥原文。
- `assistant.status_overview` 可在用户询问“你现在记着什么”“刚才那个还在吗”“还有哪些没处理”时，只读汇总待补信息、待确认、待安排、待提醒和待推进事项；它不访问日历，但会把活跃 Seed Lite 同步到短期 `state.seed_items`，把搁置项同步到 `state.shelved_seed_items`，方便后续“第几个完成了 / 第几个今天下午 / 搁置区第几个恢复”按各自列表续接。`status: "shelved"` 的事项不会出现在活跃 Watchlist 和排程兜底里，只在状态总览里显示搁置区数量提示和恢复入口。
- `assistant.status_overview` 的下一步提示会优先使用“待确认里的排程推荐 / 待确认里的删除确认 / 待提醒里的第几个不用提醒 / 待提醒里的第几个提前 2 小时 / 待安排里的第几个 / 待推进里的第几个完成了 / 待推进里的第几个先不管”，和各自执行合同的作用域保持一致。
- `assistant.status_overview` 和 Seed Lite 同步会把活跃待推进拆成 `pending_reminder_seed_items`、`pending_schedule_seed_items`、`pending_todo_seed_items` 三组短期状态，方便模型下一轮按分组续接；搁置项仍只进入 `shelved_seed_items`。
- `assistant.manage_todos.target.group` 可作为编号作用域：单独传 `group` 表示整组；`group + itemNumber / itemNumbers / title / seedId` 表示只在该组内寻找目标，避免“待提醒里的第二个”误处理整组。
- 手动早晚报和主动早晚报会先调用 `watchlist-pullback` 推进过期 Seed Lite：同一事项每天最多记录一次温和拉回，累计两次后自动标记为 `status: "shelved"`，后续只显示搁置区轻提示，避免反复打扰；温和拉回提示会按实际分组给出“待安排里的第几个 / 待提醒里的第几个 / 待推进里的第几个”下一步，不再使用无对象的“今天下午处理 / 先不管 / 完成了”。
- `assistant.manage_todos(operation: "shelve")` 用于“第一个先不管 / 暂时搁置”这类低摩擦回复；它只把 Seed Lite 项标记为 `status: "shelved"`，不删除、不写日历。搁置成功回执会提示“看看搁置区 / 搁置区第几个恢复”，让用户知道这不是删除，也能一句话找回。
- `assistant.manage_todos(operation: "list_shelved" | "restore")` 用于查看搁置区和恢复搁置事项；搁置区列表会提示“搁置区第几个恢复”，和状态总览的恢复入口保持一致；搁置区为空但活跃待推进有事项时，会提示“看看待推进收件箱”继续处理。恢复只把事项重新放回活跃 Watchlist，不写日历、不登记提醒。恢复成功回执会提示“看看待推进收件箱”继续处理；恢复目标找不到时，失败回执会留在搁置区作用域，展示“当前搁置区”和“搁置区第几个恢复”，不回退到活跃待推进列表。
- `assistant.manage_todos(operation: "list")` 的待推进收件箱列表会按实际存在的分组生成下一步提示：普通待推进提示“待推进里的第几个完成了”，有目标日期但未定提醒的事项提示“待安排里的第几个安排一下”，已有提醒的事项提示“待提醒里的第几个不用提醒”，避免无对象的“第几个 / 这个”误指向其他事项。活跃待推进为空但搁置区有事项时，会提示“看看搁置区 / 搁置区第几个恢复”，避免把搁置误看成遗忘。目标找不到或标题模糊命中多个时，失败回执也会附上当前收件箱和同一套分组下一步提示，方便用户直接改口继续处理。
- `assistant.manage_todos(operation: "complete" | "delete")` 完成或取消事项后，如果活跃待推进收件箱仍有剩余事项，成功回执会补“还有 N 件待推进，可以说看看待推进收件箱继续处理”，让用户可以顺手处理下一件。
- `assistant.manage_todos(operation: "update", patch.clearReminder: true)` 只关闭 Seed Lite 事项上的提醒时间，不完成、不取消事项；成功回执会说明“事项还在待推进，可以说看看待推进收件箱继续处理”。
- `assistant.manage_todos(operation: "update", patch.reminderAt)` 给 Seed Lite 事项补提醒时间后，事项会进入待提醒分组；成功回执会提示可继续说“待提醒里的第几个不用提醒 / 提前 2 小时”。
- `assistant.manage_todos(operation: "update", patch.targetDate)` 给 Seed Lite 事项补目标日期后，事项会进入待安排分组；成功回执会提示可继续说“待安排里的第几个安排一下 / 待安排的都给我推荐一下”。
- `assistant.dismiss_context` 可在用户说“算了”“先不管了”这类放弃当前短期上下文时，清理待补时间、待确认推荐、待确认删除、冲突确认和图片草稿；它不访问日历、不写 Seed Lite。
- 两段路由实验已经从活跃源码中移除，不再出现在公共导出、能力目录或测试入口中；历史结论保留在内部设计记录里。
- 能力目录只登记已实现能力；未验证或计划中的能力只能放在计划和评审文档里。

暂不包含：

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
