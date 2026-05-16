// 进阶压测扩展题库：把真实使用闭环从 64 条扩到 100 条，不触碰线上语义路由。

import type { SeedLiteItem } from "../seed-lite/index.js";
import type { ShortTermState } from "../state/index.js";
import type {
  AdvancedFinalEventExpectation,
  AdvancedFinalSeedExpectation,
  AdvancedRegressionScenario,
} from "./advanced-regression-cases.js";

const TODAY = "2026-05-08";
const TOMORROW = "2026-05-09";

// 汇总新增场景，保持主题库入口只负责拼装。
export function expandedAdvancedRegressionScenarios(): AdvancedRegressionScenario[] {
  return [
    ...expandedCreateDraftScenarios(),
    ...expandedBatchCreateScenarios(),
    ...expandedMixedCreateScheduleScenarios(),
    ...expandedScheduleContextScenarios(),
    ...expandedTodoAutoScheduleScenarios(),
    ...expandedTodoInboxManagementScenarios(),
  ];
}

// 覆盖缺时间草稿、跨天草稿和低摩擦放弃上下文。
function expandedCreateDraftScenarios(): AdvancedRegressionScenario[] {
  return [
    createDraft("004", "明天和产品聊一下", "和产品聊一下", TOMORROW, "12点半", "12:30"),
    createDraft("005", "周六安排一下家庭复盘", "家庭复盘", TOMORROW, "下午4点", "16:00", {
      firstActionTypes: ["clarify", "propose_schedule", "create_event"],
      firstReplyIncludes: [],
    }),
    {
      id: "advanced_create_draft_006",
      category: "create_draft_clarification",
      steps: [
        {
          text: "今天要和财务过一下口径",
          expected: { actionType: "create_event", actionTypes: ["clarify", "create_event"], replyIncludes: [] },
        },
        {
          text: "下午2点半",
          expected: { actionType: "create_event", actionTypes: ["create_event", "update_event"], replyIncludes: ["已"] },
        },
      ],
      expectedFinalEvents: [event("evt_1", "和财务过口径", TODAY, "14:30", ["和财务过口径", "和财务过一下口径"])],
    },
    {
      id: "advanced_create_draft_dismiss_001",
      category: "create_draft_clarification",
      steps: [
        { text: "明天约张总开会", expected: { actionType: "clarify", replyIncludes: ["几点"] } },
        { text: "算了，先不管了", expected: { actionType: "dismiss_context", replyIncludes: ["已清空"] } },
      ],
      expectedFinalEvents: [],
    },
  ];
}

// 覆盖更多批量创建后的第几条承接修改。
function expandedBatchCreateScenarios(): AdvancedRegressionScenario[] {
  return [
    {
      id: "advanced_batch_create_context_004",
      category: "batch_create_context",
      steps: [
        { text: "明天9点晨会，11点法务电话，都放进日历", expected: { actionType: "create_events", replyIncludes: ["已新增"] } },
        { text: "把第一个改到10点半", expected: { actionType: "update_event", replyIncludes: ["已修改"] } },
      ],
      expectedFinalEvents: [
        event("evt_1", "晨会", TOMORROW, "10:30"),
        event("evt_2", "法务电话", TOMORROW, "11:00"),
      ],
    },
    {
      id: "advanced_batch_create_context_005",
      category: "batch_create_context",
      steps: [
        { text: "明天10点项目会，下午2点写邮件，下午4点复盘，都帮我记一下", expected: { actionType: "create_events", replyIncludes: ["已新增"] } },
        { text: "第三个改到下午5点", expected: { actionType: "update_event", replyIncludes: ["已修改"] } },
      ],
      expectedFinalEvents: [
        event("evt_1", "项目会", TOMORROW, "10:00"),
        event("evt_2", "写邮件", TOMORROW, "14:00"),
        event("evt_3", "复盘", TOMORROW, "17:00"),
      ],
    },
    {
      id: "advanced_batch_create_context_006",
      category: "batch_create_context",
      steps: [
        { text: "今天下午1点看合同，下午3点供应商电话，一起加上", expected: { actionType: "create_events", replyIncludes: ["已新增"] } },
        { text: "第二条标题改成供应商价格电话", expected: { actionType: "update_event", replyIncludes: ["已修改"] } },
      ],
      expectedFinalEvents: [
        event("evt_1", "看合同", TODAY, "13:00"),
        event("evt_2", "供应商价格电话", TODAY, "15:00"),
      ],
    },
  ];
}

// 覆盖“明确时间 + 待推荐事项”以及冲突后仍保留排程推荐。
function expandedMixedCreateScheduleScenarios(): AdvancedRegressionScenario[] {
  return [
    mixedCreate("003", "周六上午9点足球课，下午整理玩具和买生日礼物", "足球课", "09:00", ["整理玩具", "买生日礼物"]),
    mixedConflict("004", "周六上午9点足球课，下午整理玩具和买生日礼物", "足球课", "09:00", ["整理玩具", "买生日礼物"]),
    mixedCreate("005", "明天上午10点路演彩排，下午安排写反馈邮件", "路演彩排", "10:00", "写反馈邮件"),
    mixedConflict("006", "明天上午10点路演彩排，下午安排写反馈邮件", "路演彩排", "10:00", "写反馈邮件"),
  ];
}

// 覆盖候选数量、时段重排、多事项对应修改、默认日期和旧状态门禁。
function expandedScheduleContextScenarios(): AdvancedRegressionScenario[] {
  return [
    scheduleConfirm("009", "明天帮我安排看商业计划书，给我5个候选", "看商业计划书", "选第三个", "10:00"),
    scheduleConfirm("010", "明天把写投资 memo 排一下，给我2个候选", "写投资 memo", "第2个吧", "09:30"),
    scheduleReproposal("011", "明天把整理会议纪要排一下，推荐时间", "整理会议纪要", "晚一点再推荐", "第一个就行", "15:00"),
    {
      id: "advanced_schedule_context_012",
      category: "schedule_context",
      steps: [
        { text: "明天把找律师和更新模型排一下", expected: { actionType: "propose_schedule", replyIncludes: ["可选时间"] } },
        { text: "第一个10点，第二个11点", expected: { actionType: "create_events", replyIncludes: ["已新增"] } },
      ],
      expectedFinalEvents: [
        event("evt_1", "找律师", TOMORROW, "10:00"),
        event("evt_2", "更新模型", TOMORROW, "11:00"),
      ],
    },
    {
      id: "advanced_schedule_context_013",
      category: "schedule_context",
      seedEvents: [event("evt_busy_013", "已有晨会", TOMORROW, "09:00")],
      steps: [
        { text: "明天帮我排一下看法律条款", expected: { actionType: "propose_schedule", replyIncludes: ["可选时间"] } },
        { text: "第一个可以", expected: { actionType: "create_event", replyIncludes: ["已新增"] } },
      ],
      expectedFinalEvents: [
        event("evt_busy_013", "已有晨会", TOMORROW, "09:00"),
        event("evt_2", "看法律条款", TOMORROW, "10:00"),
      ],
    },
    scheduleConfirm("014", "明天下午帮我安排复盘预算，不要上午", "复盘预算", "选第一个", "14:00"),
    {
      id: "advanced_schedule_context_015",
      category: "schedule_context",
      steps: [
        { text: "帮我安排一下写周报", expected: { actionType: "propose_schedule", replyIncludes: ["可选时间", "写周报"] } },
        { text: "选第一个", expected: { actionType: "create_event", replyIncludes: ["已新增"] } },
      ],
      expectedFinalEvents: [{ ...event("evt_1", "写周报", TODAY, "09:00"), startTimes: ["09:00", "09:30"] }],
    },
    {
      id: "advanced_schedule_context_016",
      category: "schedule_context",
      initialState: stalePendingSchedule("旧事项"),
      steps: [{ text: "今天帮我安排一个新事项：整理材料", expected: { actionType: "propose_schedule", replyIncludes: ["整理材料"] } }],
      expectedFinalEvents: [],
    },
    {
      id: "advanced_schedule_context_017",
      category: "schedule_context",
      initialState: {
        pending_clarification: {
          question: "这个日程几点开始？",
          missing: ["startTime"],
          createDraft: { title: "旧会议", date: TOMORROW },
        },
      },
      steps: [{ text: "不是这个，帮我给处理发票推荐几个时间", expected: { actionType: "propose_schedule", replyIncludes: ["可选时间", "处理发票"] } }],
      expectedFinalEvents: [],
    },
    {
      id: "advanced_schedule_context_018",
      category: "schedule_context",
      seedItems: [seedItem("seed_1", "整理 DCF"), seedItem("seed_2", "写邮件")],
      steps: [
        { text: "把第一个和第二个安排一下", expected: { actionType: "propose_schedule", replyIncludes: ["整理 DCF", "写邮件"] } },
        { text: "选第一个", expected: { actionType: "create_events", replyIncludes: ["已新增"] } },
      ],
      expectedFinalEvents: [
        event("evt_1", "整理 DCF", TODAY, "09:30"),
        event("evt_2", "写邮件", TODAY, "10:30"),
      ],
      expectedFinalSeedItems: [],
    },
  ];
}

// 覆盖更多没有时间的自然事项自动接住并安排。
function expandedTodoAutoScheduleScenarios(): AdvancedRegressionScenario[] {
  return [
    todoAuto("003", "把财务口径弄完", "财务口径", ["财务口径", "把财务口径弄完", "财务口径这件事"]),
    todoAuto("004", "DCF模型先处理一下", "DCF 模型", ["DCF 模型", "DCF模型", "DCF 模型处理"]),
    todoAuto("005", "帮我把写邮件搞定", "写邮件"),
    todoAuto("006", "处理一下收购清单", "收购清单", ["收购清单", "处理收购清单"]),
    todoAuto("007", "把路演反馈收尾", "路演反馈", ["路演反馈", "路演反馈收尾"]),
  ];
}

// 覆盖查看、完成、取消、改名、改日期和提醒管理。
function expandedTodoInboxManagementScenarios(): AdvancedRegressionScenario[] {
  return [
    todoInbox("006", "第二个不用再记了", "delete", [seedItem("seed_1", "拿币"), seedItem("seed_2", "整理 DCF")], ["已取消待推进", "整理 DCF"], [seedExpectation("seed_1", "拿币")]),
    todoInbox("007", "第二个明天下午提醒我", "update", [seedItem("seed_1", "拿币"), seedItem("seed_2", "整理 DCF")], ["已更新待推进", "提醒"], [seedExpectation("seed_1", "拿币"), seedExpectation("seed_2", "整理 DCF", undefined, "2026-05-09 14:00")]),
    todoInbox("008", "今天只看最重要的3个", "list", [seedItem("seed_1", "拿币"), seedItem("seed_2", "整理 DCF"), seedItem("seed_3", "写邮件"), seedItem("seed_4", "看材料")], ["待推进", "1. 拿币", "3. 写邮件"], [seedExpectation("seed_1", "拿币"), seedExpectation("seed_2", "整理 DCF"), seedExpectation("seed_3", "写邮件"), seedExpectation("seed_4", "看材料")]),
    todoInbox("009", "把第一个改名成整理锐盟 DCF", "update", [seedItem("seed_1", "整理 DCF")], ["已更新待推进", "整理锐盟 DCF"], [seedExpectation("seed_1", "整理锐盟 DCF")]),
    todoInbox("010", "前两个都完成了", "complete", [seedItem("seed_1", "拿币"), seedItem("seed_2", "整理 DCF"), seedItem("seed_3", "写邮件")], ["已完成待推进", "拿币", "整理 DCF"], [seedExpectation("seed_3", "写邮件")]),
    todoInbox("011", "整理 DCF 先取消", "delete", [seedItem("seed_1", "拿币"), seedItem("seed_2", "整理 DCF")], ["已取消待推进", "整理 DCF"], [seedExpectation("seed_1", "拿币")]),
    todoInbox("012", "第一条明天处理", "update", [seedItem("seed_1", "拿币")], ["已更新待推进", "拿币"], [seedExpectation("seed_1", "拿币", TOMORROW)]),
    todoInbox("013", "第一个和第二个先别提醒了", "update", [seedItem("seed_1", "拿币", undefined, "2026-05-10 10:00"), seedItem("seed_2", "整理 DCF", undefined, "2026-05-10 14:00")], ["已关闭提醒", "拿币", "整理 DCF"], [seedExpectation("seed_1", "拿币", undefined, null), seedExpectation("seed_2", "整理 DCF", undefined, null)]),
    todoInbox("014", "把第二个改成下周一处理", "update", [seedItem("seed_1", "拿币"), seedItem("seed_2", "写邮件")], ["已更新待推进", "写邮件"], [seedExpectation("seed_1", "拿币"), seedExpectation("seed_2", "写邮件", "2026-05-11")]),
    todoInbox("015", "现在还有什么没处理", "list", [seedItem("seed_1", "拿币"), seedItem("seed_2", "写邮件")], ["待推进", "拿币", "写邮件"], [seedExpectation("seed_1", "拿币"), seedExpectation("seed_2", "写邮件")]),
  ];
}

// 构造缺时间草稿链路。
function createDraft(
  id: string,
  firstText: string,
  title: string,
  date: string,
  followUpText: string,
  startTime: string,
  options: { firstActionTypes?: string[]; firstReplyIncludes?: string[] } = {},
): AdvancedRegressionScenario {
  return {
    id: `advanced_create_draft_${id}`,
    category: "create_draft_clarification",
    steps: [
      {
        text: firstText,
        expected: {
          actionType: "clarify",
          ...(options.firstActionTypes ? { actionTypes: options.firstActionTypes } : {}),
          replyIncludes: options.firstReplyIncludes || ["几点"],
        },
      },
      { text: followUpText, expected: { actionType: "create_event", actionTypes: ["create_event", "update_event"], replyIncludes: ["已"] } },
    ],
    expectedFinalEvents: [event("evt_1", title, date, startTime)],
  };
}

// 构造混合创建和排程场景。
function mixedCreate(id: string, text: string, title: string, startTime: string, itemTitles: string | string[]): AdvancedRegressionScenario {
  const replyIncludes = Array.isArray(itemTitles) ? itemTitles : [itemTitles];
  return {
    id: `advanced_mixed_create_schedule_${id}`,
    category: "mixed_create_schedule",
    steps: [{ text, expected: { actionType: "create_and_propose_schedule", replyIncludes: ["已新增", title, "可选时间", ...replyIncludes] } }],
    expectedFinalEvents: [event("evt_1", title, TOMORROW, startTime)],
  };
}

// 构造冲突后仍保留待推荐事项的混合场景。
function mixedConflict(id: string, text: string, title: string, startTime: string, itemTitles: string | string[]): AdvancedRegressionScenario {
  const replyIncludes = Array.isArray(itemTitles) ? itemTitles : [itemTitles];
  return {
    id: `advanced_mixed_create_schedule_${id}`,
    category: "mixed_create_schedule",
    seedEvents: [event(`evt_existing_mixed_${id}`, title, TOMORROW, startTime)],
    steps: [{ text, expected: { actionType: "create_and_propose_schedule", replyIncludes: ["这个时间已有日程", title, "可选时间", ...replyIncludes] } }],
    expectedFinalEvents: [event(`evt_existing_mixed_${id}`, title, TOMORROW, startTime)],
  };
}

// 构造排程后直接选择推荐位的场景。
function scheduleConfirm(id: string, firstText: string, title: string, secondText: string, startTime: string): AdvancedRegressionScenario {
  return {
    id: `advanced_schedule_context_${id}`,
    category: "schedule_context",
    steps: [
      { text: firstText, expected: { actionType: "propose_schedule", replyIncludes: ["可选时间", title] } },
      { text: secondText, expected: { actionType: "create_event", replyIncludes: ["已新增"] } },
    ],
    expectedFinalEvents: [event("evt_1", title, TOMORROW, startTime)],
  };
}

// 构造重新推荐后再确认的场景。
function scheduleReproposal(id: string, firstText: string, title: string, secondText: string, thirdText: string, startTime: string): AdvancedRegressionScenario {
  return {
    id: `advanced_schedule_context_${id}`,
    category: "schedule_context",
    steps: [
      { text: firstText, expected: { actionType: "propose_schedule", replyIncludes: ["可选时间", title] } },
      { text: secondText, expected: { actionType: "propose_schedule", replyIncludes: ["可选时间"] } },
      { text: thirdText, expected: { actionType: "create_event", replyIncludes: ["已新增"] } },
    ],
    expectedFinalEvents: [event("evt_1", title, TOMORROW, startTime)],
  };
}

// 构造自然待办自动排程场景。
function todoAuto(id: string, text: string, title: string, titles?: string[]): AdvancedRegressionScenario {
  return {
    id: `advanced_todo_auto_schedule_${id}`,
    category: "todo_auto_schedule",
    steps: [{ text, expected: { actionType: "create_event", replyIncludes: ["已新增"] } }],
    expectedFinalEvents: [event("evt_1", title, TODAY, "09:30", titles)],
  };
}

// 构造待推进收件箱管理场景。
function todoInbox(
  id: string,
  text: string,
  operation: "list" | "complete" | "delete" | "update",
  seedItems: SeedLiteItem[],
  expectedReplyIncludes: string[],
  expectedFinalSeedItems: AdvancedFinalSeedExpectation[],
): AdvancedRegressionScenario {
  return {
    id: `advanced_todo_inbox_${id}`,
    category: "todo_inbox_management",
    seedItems,
    steps: [
      {
        text,
        expected: {
          actionType: "manage_todos",
          ...(operation === "list" ? { actionTypes: ["manage_todos", "status_overview"] } : {}),
          replyIncludes: expectedReplyIncludes,
        },
        expectedSeedItemsAfterStep: expectedFinalSeedItems,
      },
    ],
    expectedFinalEvents: [],
    expectedFinalSeedItems,
  };
}

// 构造旧排程状态，验证新事项不会误复用旧上下文。
function stalePendingSchedule(title: string): ShortTermState {
  return {
    pending_schedule: {
      date: "2026-05-07",
      options: [{ optionNumber: 1, items: [{ itemNumber: 1, title, date: "2026-05-07", startTime: "10:00", durationMinutes: 60 }] }],
    },
  };
}

// 构造日程预期。
function event(id: string, title: string, date: string, startTime: string, titles?: string[]): AdvancedFinalEventExpectation {
  return { id, title, ...(titles ? { titles } : {}), date, startTime };
}

// 构造待推进种子。
function seedItem(seedId: string, title: string, targetDate?: string, reminderAt?: string): SeedLiteItem {
  return { seedId, title, ...(targetDate ? { targetDate } : {}), ...(reminderAt ? { reminderAt } : {}) };
}

// 构造待推进最终状态预期。
function seedExpectation(seedId: string, title: string, targetDate?: string | string[], reminderAt?: string | null): AdvancedFinalSeedExpectation {
  return {
    seedId,
    title,
    ...(Array.isArray(targetDate) ? { targetDates: targetDate } : targetDate ? { targetDate } : {}),
    ...(reminderAt !== undefined ? { reminderAt } : {}),
  };
}
