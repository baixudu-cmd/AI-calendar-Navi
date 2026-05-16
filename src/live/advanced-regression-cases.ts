// 进阶真实压测场景：覆盖已经落地的状态能力，不写真实飞书。

import type { ShortTermState } from "../state/index.js";
import type { SeedLiteItem } from "../seed-lite/index.js";
import { expandedAdvancedRegressionScenarios } from "./advanced-regression-expanded-cases.js";

export type AdvancedSeedEvent = {
  id: string;
  title: string;
  date: string;
  startTime: string;
};

export const advancedRegressionCategories = [
  "briefing_title_update",
  "briefing_time_update",
  "evening_briefing_update",
  "last_event_time_update",
  "last_event_title_update",
  "delete_confirm",
  "delete_cancel",
  "create_draft_clarification",
  "batch_create_context",
  "mixed_create_schedule",
  "schedule_context",
  "todo_auto_schedule",
  "todo_inbox_management",
] as const;

export type AdvancedRegressionCategory = (typeof advancedRegressionCategories)[number];

export type AdvancedFinalEventExpectation = {
  id: string;
  title: string;
  titles?: string[];
  date: string;
  startTime: string;
  startTimes?: string[];
};

export type AdvancedFinalSeedExpectation = {
  seedId: string;
  title: string;
  targetDate?: string;
  targetDates?: string[];
  reminderAt?: string | null;
};

export type AdvancedStepExpectation = {
  actionType: string;
  actionTypes?: string[];
  ok?: boolean;
  replyIncludes?: string[];
};

export type AdvancedRegressionStep = {
  text: string;
  expected: AdvancedStepExpectation;
  expectedEventsAfterStep?: AdvancedFinalEventExpectation[];
  expectedSeedItemsAfterStep?: AdvancedFinalSeedExpectation[];
};

export type AdvancedRegressionScenario = {
  id: string;
  category: AdvancedRegressionCategory;
  seedEvents?: AdvancedSeedEvent[];
  seedItems?: SeedLiteItem[];
  initialState?: ShortTermState;
  steps: AdvancedRegressionStep[];
  expectedFinalEvents: AdvancedFinalEventExpectation[];
  expectedFinalSeedItems?: AdvancedFinalSeedExpectation[];
};

export const ADVANCED_REGRESSION_TODAY = "2026-05-08";
export const ADVANCED_REGRESSION_NOW = "2026-05-08T09:00:00+08:00";

const TODAY = "2026-05-08";
const TOMORROW = "2026-05-09";

// 统一构造固定题库，避免 40 条场景对象散落后难以核对分类和最终状态。
export const advancedRegressionScenarios: AdvancedRegressionScenario[] = [
  ...briefingTitleUpdateScenarios(),
  ...briefingTimeUpdateScenarios(),
  ...eveningBriefingUpdateScenarios(),
  ...lastEventTimeUpdateScenarios(),
  ...lastEventTitleUpdateScenarios(),
  ...deleteConfirmScenarios(),
  ...deleteCancelScenarios(),
  ...createDraftClarificationScenarios(),
  ...batchCreateContextScenarios(),
  ...mixedCreateScheduleScenarios(),
  ...scheduleContextScenarios(),
  ...todoAutoScheduleScenarios(),
  ...todoInboxManagementScenarios(),
  ...expandedAdvancedRegressionScenarios(),
];

type BriefingTitleCase = {
  id: string;
  opener: string;
  title: string;
  startTime: string;
  nextTitle: string;
  openerActionTypes?: string[];
};

type BriefingTimeCase = {
  id: string;
  opener: string;
  title: string;
  startTime: string;
  nextText: string;
  nextStartTime: string;
};

type LastEventCase = {
  id: string;
  text: string;
  title: string;
  startTime: string;
  nextTitle?: string;
  nextStartTime?: string;
};

type DeleteCase = {
  id: string;
  mode: "last_event" | "briefing_item";
  title: string;
  startTime: string;
};

type CreateDraftCase = {
  id: string;
  firstText: string;
  title: string;
  date: string;
  followUpText: string;
  startTime: string;
  firstActionTypes?: string[];
  firstReplyIncludes?: string[];
};

type BatchCreateCase = {
  id: string;
  firstText: string;
  firstTitle: string;
  firstStartTime: string;
  secondTitle: string;
  secondStartTime: string;
  updateText: string;
  updatedSecondStartTime: string;
};

type ScheduleContextCase = {
  id: string;
  seed?: AdvancedSeedEvent;
  firstText: string;
  secondText: string;
  thirdText?: string;
  secondActionType: "create_event" | "create_events" | "propose_schedule";
  expectedFinalEvents: AdvancedFinalEventExpectation[];
};

type TodoAutoScheduleCase = {
  id: string;
  text: string;
  title: string;
  startTime: string;
};

type TodoInboxCase = {
  id: string;
  text: string;
  operation: "list" | "complete" | "delete" | "update";
  seedItems: SeedLiteItem[];
  expectedReplyIncludes: string[];
  expectedFinalSeedItems: AdvancedFinalSeedExpectation[];
};

function briefingTitleUpdateScenarios(): AdvancedRegressionScenario[] {
  const cases: BriefingTitleCase[] = [
    { id: "001", opener: "发我今天早报", title: "投委会", startTime: "09:00", nextTitle: "投委会预沟通" },
    { id: "002", opener: "给我今天早报", title: "电话会", startTime: "10:00", nextTitle: "客户电话会" },
    { id: "003", opener: "看下今天早报", title: "路演彩排", startTime: "11:00", nextTitle: "路演正式彩排" },
    { id: "004", opener: "今天早报发我一下", title: "材料复核", startTime: "14:00", nextTitle: "申报材料复核" },
    { id: "005", opener: "整理今天早报", title: "项目会", startTime: "15:00", nextTitle: "项目周会" },
    { id: "006", opener: "发一下今天早报", title: "预算沟通", startTime: "16:00", nextTitle: "预算口径沟通" },
  ];

  return cases.map((item) => {
    const seed = event(`evt_bt_${item.id}`, item.title, TODAY, item.startTime);
    return {
      id: `advanced_briefing_title_${item.id}`,
      category: "briefing_title_update",
      seedEvents: [seed],
      steps: [
        { text: item.opener, expected: { actionType: "daily_briefing", replyIncludes: ["早报", item.title] } },
        { text: `把第1条改成${item.nextTitle}`, expected: { actionType: "update_event", replyIncludes: ["已修改"] } },
      ],
      expectedFinalEvents: [event(seed.id, item.nextTitle, seed.date, seed.startTime)],
    };
  });
}

function briefingTimeUpdateScenarios(): AdvancedRegressionScenario[] {
  const cases: BriefingTimeCase[] = [
    { id: "001", opener: "发我今天早报", title: "晨会", startTime: "09:00", nextText: "把第1条改到10点", nextStartTime: "10:00" },
    { id: "002", opener: "给我今天早报", title: "投后沟通", startTime: "10:30", nextText: "把第1条改到下午2点", nextStartTime: "14:00" },
    { id: "003", opener: "看下今天早报", title: "合同讨论", startTime: "11:00", nextText: "把第1条改到下午3点半", nextStartTime: "15:30" },
    { id: "004", opener: "今天早报发我一下", title: "产品评审", startTime: "13:00", nextText: "把第1条改到下午5点", nextStartTime: "17:00" },
    { id: "005", opener: "整理今天早报", title: "融资跟进", startTime: "15:00", nextText: "把第1条改到晚上7点", nextStartTime: "19:00" },
    { id: "006", opener: "发一下今天早报", title: "团队同步", startTime: "16:00", nextText: "把第1条改到上午8点半", nextStartTime: "08:30" },
  ];

  return cases.map((item) => {
    const seed = event(`evt_bm_${item.id}`, item.title, TODAY, item.startTime);
    return {
      id: `advanced_briefing_time_${item.id}`,
      category: "briefing_time_update",
      seedEvents: [seed],
      steps: [
        { text: item.opener, expected: { actionType: "daily_briefing", replyIncludes: ["早报", item.title] } },
        { text: item.nextText, expected: { actionType: "update_event", replyIncludes: ["已修改"] } },
      ],
      expectedFinalEvents: [event(seed.id, seed.title, seed.date, item.nextStartTime)],
    };
  });
}

function eveningBriefingUpdateScenarios(): AdvancedRegressionScenario[] {
  const titleCases: BriefingTitleCase[] = [
    { id: "001", opener: "晚上帮我复盘明天安排", title: "董事会", startTime: "10:00", nextTitle: "董事会预沟通" },
    { id: "002", opener: "给我明天晚报", title: "客户拜访", startTime: "14:00", nextTitle: "重点客户拜访" },
    { id: "003", opener: "今晚帮我看下明天安排", title: "项目例会", startTime: "16:00", nextTitle: "项目复盘会", openerActionTypes: ["daily_briefing", "list_events"] },
  ];
  const timeCases: BriefingTimeCase[] = [
    { id: "004", opener: "晚上帮我复盘明天安排", title: "材料会", startTime: "09:00", nextText: "把第1条改到下午4点", nextStartTime: "16:00" },
    { id: "005", opener: "给我明天晚报", title: "路演沟通", startTime: "11:00", nextText: "把第1条改到下午3点", nextStartTime: "15:00" },
    { id: "006", opener: "今晚帮我做明天晚报", title: "财务确认", startTime: "15:00", nextText: "把第1条改到上午10点", nextStartTime: "10:00" },
  ];

  return [
    ...titleCases.map((item) => {
      const seed = event(`evt_eb_${item.id}`, item.title, TOMORROW, item.startTime);
      return {
        id: `advanced_evening_briefing_${item.id}`,
        category: "evening_briefing_update" as const,
        seedEvents: [seed],
        steps: [
          { text: item.opener, expected: { actionType: "daily_briefing", actionTypes: item.openerActionTypes, replyIncludes: item.openerActionTypes?.includes("list_events") ? [item.title] : ["晚报", item.title] } },
          { text: `把第1条改成${item.nextTitle}`, expected: { actionType: "update_event", replyIncludes: ["已修改"] } },
        ],
        expectedFinalEvents: [event(seed.id, item.nextTitle, seed.date, seed.startTime)],
      };
    }),
    ...timeCases.map((item) => {
      const seed = event(`evt_eb_${item.id}`, item.title, TOMORROW, item.startTime);
      return {
        id: `advanced_evening_briefing_${item.id}`,
        category: "evening_briefing_update" as const,
        seedEvents: [seed],
        steps: [
          { text: item.opener, expected: { actionType: "daily_briefing", replyIncludes: ["晚报", item.title] } },
          { text: item.nextText, expected: { actionType: "update_event", replyIncludes: ["已修改"] } },
        ],
        expectedFinalEvents: [event(seed.id, seed.title, seed.date, item.nextStartTime)],
      };
    }),
  ];
}

function lastEventTimeUpdateScenarios(): AdvancedRegressionScenario[] {
  const cases: LastEventCase[] = [
    { id: "001", text: "改到晚上9点", title: "投资人晚餐", startTime: "20:00", nextStartTime: "21:00" },
    { id: "002", text: "提前到下午4点", title: "法务沟通", startTime: "17:00", nextStartTime: "16:00" },
    { id: "003", text: "刚才那个改到上午10点", title: "财务电话", startTime: "11:00", nextStartTime: "10:00" },
    { id: "004", text: "这个挪到下午2点半", title: "材料会", startTime: "13:00", nextStartTime: "14:30" },
    { id: "005", text: "时间改成晚上8点", title: "复盘会", startTime: "19:00", nextStartTime: "20:00" },
    { id: "006", text: "改到早上8点半", title: "晨跑提醒", startTime: "07:30", nextStartTime: "08:30" },
  ];

  return cases.map((item) => {
    const seed = event(`evt_lt_${item.id}`, item.title, TODAY, item.startTime);
    return {
      id: `advanced_last_event_time_${item.id}`,
      category: "last_event_time_update",
      seedEvents: [seed],
      initialState: lastEventState(seed),
      steps: [{ text: item.text, expected: { actionType: "update_event", replyIncludes: ["已修改"] } }],
      expectedFinalEvents: [event(seed.id, seed.title, seed.date, item.nextStartTime || seed.startTime)],
    };
  });
}

function lastEventTitleUpdateScenarios(): AdvancedRegressionScenario[] {
  const cases: LastEventCase[] = [
    { id: "001", text: "标题改成见王总", title: "见客户", startTime: "10:00", nextTitle: "见王总" },
    { id: "002", text: "刚才那个改成融资材料会", title: "材料会", startTime: "11:00", nextTitle: "融资材料会" },
    { id: "003", text: "名字改成团队复盘", title: "复盘", startTime: "14:00", nextTitle: "团队复盘" },
    { id: "004", text: "这条改成产品评审会", title: "评审", startTime: "15:00", nextTitle: "产品评审会" },
    { id: "005", text: "标题改成客户晚餐", title: "晚餐", startTime: "18:30", nextTitle: "客户晚餐" },
    { id: "006", text: "刚才那个叫投后沟通", title: "电话会", startTime: "16:30", nextTitle: "投后沟通" },
  ];

  return cases.map((item) => {
    const seed = event(`evt_lh_${item.id}`, item.title, TODAY, item.startTime);
    return {
      id: `advanced_last_event_title_${item.id}`,
      category: "last_event_title_update",
      seedEvents: [seed],
      initialState: lastEventState(seed),
      steps: [{ text: item.text, expected: { actionType: "update_event", replyIncludes: ["已修改"] } }],
      expectedFinalEvents: [event(seed.id, item.nextTitle || seed.title, seed.date, seed.startTime)],
    };
  });
}

function deleteConfirmScenarios(): AdvancedRegressionScenario[] {
  const cases: DeleteCase[] = [
    { id: "001", mode: "last_event", title: "电话会", startTime: "10:00" },
    { id: "002", mode: "last_event", title: "路演彩排", startTime: "15:00" },
    { id: "003", mode: "last_event", title: "材料复核", startTime: "16:00" },
    { id: "004", mode: "briefing_item", title: "预算沟通", startTime: "09:30" },
    { id: "005", mode: "briefing_item", title: "项目同步", startTime: "14:30" },
  ];

  return cases.map((item) => buildDeleteScenario(item, "delete_confirm", true));
}

function deleteCancelScenarios(): AdvancedRegressionScenario[] {
  const cases: DeleteCase[] = [
    { id: "001", mode: "last_event", title: "客户晚餐", startTime: "19:00" },
    { id: "002", mode: "last_event", title: "投委沟通", startTime: "11:00" },
    { id: "003", mode: "last_event", title: "法务确认", startTime: "17:00" },
    { id: "004", mode: "briefing_item", title: "路演沟通", startTime: "10:30" },
    { id: "005", mode: "briefing_item", title: "产品会议", startTime: "13:30" },
  ];

  return cases.map((item) => buildDeleteScenario(item, "delete_cancel", false));
}

function createDraftClarificationScenarios(): AdvancedRegressionScenario[] {
  const cases: CreateDraftCase[] = [
    {
      id: "001",
      firstText: "明天约张总开会",
      title: "约张总开会",
      date: TOMORROW,
      followUpText: "上午10点",
      startTime: "10:00",
    },
    {
      id: "002",
      firstText: "明天安排一个项目复盘",
      title: "项目复盘",
      date: TOMORROW,
      followUpText: "明天下午3点",
      startTime: "15:00",
      firstActionTypes: ["clarify", "propose_schedule", "create_event"],
      firstReplyIncludes: [],
    },
    {
      id: "003",
      firstText: "今天加一个材料会",
      title: "材料会",
      date: TODAY,
      followUpText: "晚上8点",
      startTime: "20:00",
    },
  ];

  const normalScenarios = cases.map((item) => ({
    id: `advanced_create_draft_${item.id}`,
    category: "create_draft_clarification" as const,
    steps: [
        { text: item.firstText, expected: { actionType: "clarify", actionTypes: item.firstActionTypes, replyIncludes: item.firstReplyIncludes || ["几点"] } },
      { text: item.followUpText, expected: { actionType: "create_event", actionTypes: ["create_event", "update_event"], replyIncludes: ["已"] } },
    ],
    expectedFinalEvents: [event("evt_1", item.title, item.date, item.startTime)],
  }));

  return [
    ...normalScenarios,
    {
      id: "advanced_create_draft_interrupt_001",
      category: "create_draft_clarification" as const,
      seedEvents: [event("evt_interrupt_seed", "已存在路演", TOMORROW, "15:00")],
      steps: [
        { text: "明天约张总开会", expected: { actionType: "clarify", replyIncludes: ["几点"] } },
        { text: "查一下明天日程", expected: { actionType: "list_events", replyIncludes: ["已存在路演"] } },
      ],
      expectedFinalEvents: [event("evt_interrupt_seed", "已存在路演", TOMORROW, "15:00")],
    },
  ];
}

function batchCreateContextScenarios(): AdvancedRegressionScenario[] {
  const cases: BatchCreateCase[] = [
    {
      id: "001",
      firstText: "明天9点投委会，下午2点客户电话，都帮我记一下",
      firstTitle: "投委会",
      firstStartTime: "09:00",
      secondTitle: "客户电话",
      secondStartTime: "14:00",
      updateText: "把第二个改到下午3点",
      updatedSecondStartTime: "15:00",
    },
    {
      id: "002",
      firstText: "明天上午10点路演彩排，晚上8点看项目资料，都加上",
      firstTitle: "路演彩排",
      firstStartTime: "10:00",
      secondTitle: "看项目资料",
      secondStartTime: "20:00",
      updateText: "把第2条改到晚上9点",
      updatedSecondStartTime: "21:00",
    },
    {
      id: "003",
      firstText: "今天下午2点材料复核，下午4点团队同步，一起记一下",
      firstTitle: "材料复核",
      firstStartTime: "14:00",
      secondTitle: "团队同步",
      secondStartTime: "16:00",
      updateText: "把第二条提前到下午3点半",
      updatedSecondStartTime: "15:30",
    },
  ];

  return cases.map((item) => ({
    id: `advanced_batch_create_context_${item.id}`,
    category: "batch_create_context" as const,
    steps: [
      { text: item.firstText, expected: { actionType: "create_events", replyIncludes: ["已新增", "2 个日程"] } },
      { text: item.updateText, expected: { actionType: "update_event", replyIncludes: ["已修改"] } },
    ],
    expectedFinalEvents: [
      event("evt_1", item.firstTitle, item.id === "003" ? TODAY : TOMORROW, item.firstStartTime),
      event("evt_2", item.secondTitle, item.id === "003" ? TODAY : TOMORROW, item.updatedSecondStartTime),
    ],
  }));
}

function mixedCreateScheduleScenarios(): AdvancedRegressionScenario[] {
  return [
    {
      id: "advanced_mixed_create_schedule_001",
      category: "mixed_create_schedule" as const,
      steps: [
        {
          text: "周六上午10点澄澄游泳，下午和 hanqi 吃饭以及去奥莱",
          expected: { actionType: "create_and_propose_schedule", replyIncludes: ["已新增", "澄澄游泳", "可选时间", "hanqi"] },
        },
      ],
      expectedFinalEvents: [event("evt_1", "澄澄游泳", "2026-05-09", "10:00")],
    },
    {
      id: "advanced_mixed_create_schedule_002",
      category: "mixed_create_schedule" as const,
      seedEvents: [event("evt_existing_swim", "湛湛游泳", "2026-05-09", "10:00")],
      steps: [
        {
          text: "周六上午10点湛湛游泳，下午和 hanqi 吃饭以及去奥莱",
          expected: { actionType: "create_and_propose_schedule", replyIncludes: ["这个时间已有日程", "湛湛游泳", "可选时间", "hanqi"] },
        },
      ],
      expectedFinalEvents: [event("evt_existing_swim", "湛湛游泳", "2026-05-09", "10:00")],
    },
  ];
}

function scheduleContextScenarios(): AdvancedRegressionScenario[] {
  const cases: ScheduleContextCase[] = [
    {
      id: "001",
      seed: event("evt_schedule_busy_001", "已有晨会", TOMORROW, "09:00"),
      firstText: "明天帮我安排看锐盟材料，推荐几个时间",
      secondText: "选第二个",
      secondActionType: "create_event",
      expectedFinalEvents: [
        event("evt_schedule_busy_001", "已有晨会", TOMORROW, "09:00"),
        event("evt_2", "看锐盟材料", TOMORROW, "10:30"),
      ],
    },
    {
      id: "002",
      firstText: "明天帮我找个时间看 DCF 模型",
      secondText: "改成 11 点",
      secondActionType: "create_event",
      expectedFinalEvents: [event("evt_1", "看 DCF 模型", TOMORROW, "11:00")],
    },
    {
      id: "003",
      firstText: "明天帮我安排看材料和写邮件，给我推荐时间",
      secondText: "第一个改 11 点，第二个改下午 3 点",
      secondActionType: "create_events",
      expectedFinalEvents: [
        event("evt_1", "看材料", TOMORROW, "11:00"),
        event("evt_2", "写邮件", TOMORROW, "15:00"),
      ],
    },
    {
      id: "004",
      firstText: "明天帮我安排整理投委会材料，先推荐几个时间",
      secondText: "换下午再给我几个",
      thirdText: "选第一个",
      secondActionType: "propose_schedule",
      expectedFinalEvents: [event("evt_1", "整理投委会材料", TOMORROW, "14:00")],
    },
    {
      id: "005",
      firstText: "今天帮我推荐个时间处理拿币",
      secondText: "今天太满，明天吧",
      thirdText: "第一个可以",
      secondActionType: "propose_schedule",
      expectedFinalEvents: [event("evt_1", "处理拿币", TOMORROW, "09:00", ["处理拿币", "拿币"])],
    },
    {
      id: "006",
      firstText: "明天把看项目资料排一下，推荐时间",
      secondText: "晚一点再推荐",
      thirdText: "选第一个",
      secondActionType: "propose_schedule",
      expectedFinalEvents: [event("evt_1", "看项目资料", TOMORROW, "15:00")],
    },
  ];

  const normalScenarios = cases.map((item) => ({
    id: `advanced_schedule_context_${item.id}`,
    category: "schedule_context" as const,
    seedEvents: item.seed ? [item.seed] : undefined,
    steps: buildScheduleContextSteps(item),
    expectedFinalEvents: item.expectedFinalEvents,
  }));

  return [
    ...normalScenarios,
    {
      id: "advanced_schedule_context_007",
      category: "schedule_context" as const,
      initialState: {
        pending_schedule: {
          date: "2026-05-07",
          options: [{ optionNumber: 1, items: [{ itemNumber: 1, title: "看材料", date: "2026-05-07", startTime: "10:00", durationMinutes: 60 }] }],
        },
      },
      seedItems: [{ seedId: "seed_1", title: "拿币" }],
      steps: [{ text: "帮我给拿币推荐几个时间", expected: { actionType: "propose_schedule", replyIncludes: ["可选时间", "拿币"] } }],
      expectedFinalEvents: [],
    },
    {
      id: "advanced_schedule_context_008",
      category: "schedule_context" as const,
      initialState: {
        pending_clarification: {
          question: "这个日程几点开始？",
          missing: ["startTime"],
          createDraft: { title: "约张总开会", date: TOMORROW },
        },
      },
      seedItems: [{ seedId: "seed_1", title: "拿币" }],
      steps: [{ text: "帮我给拿币推荐几个时间", expected: { actionType: "propose_schedule", replyIncludes: ["可选时间", "拿币"] } }],
      expectedFinalEvents: [],
    },
  ];
}

function buildScheduleContextSteps(item: ScheduleContextCase): AdvancedRegressionStep[] {
  const secondReplyIncludes = item.secondActionType === "propose_schedule" ? ["可选时间"] : ["已新增"];
  const steps: AdvancedRegressionStep[] = [
    { text: item.firstText, expected: { actionType: "propose_schedule", replyIncludes: ["可选时间"] } },
    { text: item.secondText, expected: { actionType: item.secondActionType, replyIncludes: secondReplyIncludes } },
  ];
  if (item.thirdText) {
    steps.push({ text: item.thirdText, expected: { actionType: item.expectedFinalEvents.length > 1 ? "create_events" : "create_event", replyIncludes: ["已新增"] } });
  }
  return steps;
}

function todoAutoScheduleScenarios(): AdvancedRegressionScenario[] {
  const cases: TodoAutoScheduleCase[] = [
    { id: "001", text: "把拿币的事项弄完", title: "拿币", startTime: "09:30" },
    { id: "002", text: "拿币那个事先处理一下", title: "拿币", startTime: "09:30" },
  ];

  return cases.map((item) => ({
    id: `advanced_todo_auto_schedule_${item.id}`,
    category: "todo_auto_schedule" as const,
    steps: [
      { text: item.text, expected: { actionType: "create_event", replyIncludes: ["已新增", item.title] } },
    ],
    expectedFinalEvents: [event("evt_1", item.title, TODAY, item.startTime)],
  }));
}

function todoInboxManagementScenarios(): AdvancedRegressionScenario[] {
  const cases: TodoInboxCase[] = [
    {
      id: "001",
      text: "我还有哪些待推进？",
      operation: "list",
      seedItems: [seedItem("seed_1", "拿币"), seedItem("seed_2", "整理 DCF")],
      expectedReplyIncludes: ["待推进", "1. 拿币", "2. 整理 DCF"],
      expectedFinalSeedItems: [seedExpectation("seed_1", "拿币"), seedExpectation("seed_2", "整理 DCF")],
    },
    {
      id: "002",
      text: "拿币那个完成了",
      operation: "complete",
      seedItems: [seedItem("seed_1", "拿币"), seedItem("seed_2", "整理 DCF")],
      expectedReplyIncludes: ["已完成待推进", "拿币"],
      expectedFinalSeedItems: [seedExpectation("seed_2", "整理 DCF")],
    },
    {
      id: "003",
      text: "第二个先别提醒了",
      operation: "update",
      seedItems: [seedItem("seed_1", "拿币"), seedItem("seed_2", "整理 DCF", undefined, "2026-05-18 14:00")],
      expectedReplyIncludes: ["已关闭提醒", "整理 DCF"],
      expectedFinalSeedItems: [seedExpectation("seed_1", "拿币"), seedExpectation("seed_2", "整理 DCF", undefined, null)],
    },
    {
      id: "004",
      text: "把第一个改成下周处理",
      operation: "update",
      seedItems: [seedItem("seed_1", "拿币")],
      expectedReplyIncludes: ["已更新待推进", "拿币"],
      expectedFinalSeedItems: [seedExpectation("seed_1", "拿币", ["2026-05-15", "2026-05-18"])],
    },
    {
      id: "005",
      text: "第一个和第三个都完成了",
      operation: "complete",
      seedItems: [seedItem("seed_1", "拿币"), seedItem("seed_2", "整理 DCF"), seedItem("seed_3", "写邮件")],
      expectedReplyIncludes: ["已完成待推进", "拿币", "写邮件"],
      expectedFinalSeedItems: [seedExpectation("seed_2", "整理 DCF")],
    },
  ];

  return cases.map((item) => ({
    id: `advanced_todo_inbox_${item.id}`,
    category: "todo_inbox_management" as const,
    seedItems: item.seedItems,
    steps: [
      {
        text: item.text,
        expected: { actionType: "manage_todos", replyIncludes: item.expectedReplyIncludes },
        expectedSeedItemsAfterStep: item.expectedFinalSeedItems,
      },
    ],
    expectedFinalEvents: [],
    expectedFinalSeedItems: item.expectedFinalSeedItems,
  }));
}

function buildDeleteScenario(item: DeleteCase, category: "delete_confirm" | "delete_cancel", confirmed: boolean): AdvancedRegressionScenario {
  const seed = event(`evt_${category}_${item.id}`, item.title, TODAY, item.startTime);
  const requestStep = { text: "删掉刚才那个", expected: { actionType: "request_delete_event", replyIncludes: ["确认删除"] } };
  const steps =
    item.mode === "briefing_item"
      ? [
          { text: "发我今天早报", expected: { actionType: "daily_briefing", replyIncludes: ["早报", item.title] } },
          {
            text: "删掉第1条",
            expected: { actionType: "request_delete_event", replyIncludes: ["确认删除"] },
            expectedEventsAfterStep: [seed],
          },
          {
            text: confirmed ? "确认删除" : "取消",
            expected: { actionType: "confirm_delete", replyIncludes: [confirmed ? "已删除" : "已取消删除"] },
          },
        ]
      : [
          { ...requestStep, expectedEventsAfterStep: [seed] },
          {
            text: confirmed ? "确认删除" : "取消",
            expected: { actionType: "confirm_delete", replyIncludes: [confirmed ? "已删除" : "已取消删除"] },
          },
        ];

  return {
    id: `advanced_${category}_${item.id}`,
    category,
    seedEvents: [seed],
    initialState: item.mode === "last_event" ? lastEventState(seed) : undefined,
    steps,
    expectedFinalEvents: confirmed ? [] : [seed],
  };
}

function event(id: string, title: string, date: string, startTime: string, titles?: string[]): AdvancedFinalEventExpectation {
  return { id, title, ...(titles ? { titles } : {}), date, startTime };
}

function seedItem(seedId: string, title: string, targetDate?: string, reminderAt?: string): SeedLiteItem {
  return { seedId, title, ...(targetDate ? { targetDate } : {}), ...(reminderAt ? { reminderAt } : {}) };
}

function seedExpectation(seedId: string, title: string, targetDate?: string | string[], reminderAt?: string | null): AdvancedFinalSeedExpectation {
  return {
    seedId,
    title,
    ...(Array.isArray(targetDate) ? { targetDates: targetDate } : targetDate ? { targetDate } : {}),
    ...(reminderAt !== undefined ? { reminderAt } : {}),
  };
}

function lastEventState(seed: AdvancedSeedEvent): ShortTermState {
  return { last_event: { eventId: seed.id, title: seed.title, date: seed.date, startTime: seed.startTime } };
}
