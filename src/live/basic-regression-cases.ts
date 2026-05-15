// 基础真实压测样例：金融/投资人口吻的高频日程输入，不包含修复逻辑。

import type { CalendarAction } from "../contract/index.js";
import type { ShortTermState } from "../state/index.js";

export type ExpectedRegressionAction = {
  type: CalendarAction["type"];
  titleIncludes?: string | string[];
  date?: string;
  startTime?: string;
  briefingType?: "morning" | "evening";
};

export type BasicRegressionStage = "basic" | "advanced";

export type BasicRegressionCase = {
  id: string;
  stage?: BasicRegressionStage;
  text: string;
  expected: ExpectedRegressionAction;
  initialState?: ShortTermState;
};

export const BASIC_REGRESSION_NOW = "2026-05-08T09:00:00+08:00";

export const basicRegressionCases: BasicRegressionCase[] = [
  create("create_001", "我明天7点开会，记录一下", ["开会", "会"], "2026-05-09", "07:00"),
  create("create_002", "我晚上8点吃个饭", "饭", "2026-05-08", "20:00"),
  create("create_003", "明天上午九点和张总电话会", "张总", "2026-05-09", "09:00"),
  create("create_004", "明天下午三点见红杉的王总", "王总", "2026-05-09", "15:00"),
  create("create_005", "后天十点投委会，帮我记一下", "投委会", "2026-05-10", "10:00"),
  create("create_006", "周一早上8点半和法务过协议", "法务", "2026-05-11", "08:30"),
  create("create_007", "下周二下午2点路演彩排", "路演", "2026-05-12", "14:00"),
  create("create_008", "今晚九点复盘项目材料", ["项目材料", "项目资料", "材料", "资料"], "2026-05-08", "21:00"),
  create("create_009", "明天中午12点约刘总吃饭", "刘总", "2026-05-09", "12:00"),
  create("create_010", "明天14点和IR团队开会", "IR", "2026-05-09", "14:00"),
  create("create_011", "后天下午4点看BP", "BP", "2026-05-10", "16:00"),
  create("create_012", "周三晚上8点约基金LP吃饭", "LP", "2026-05-13", "20:00"),
  create("create_013", "明早7点半出发去拜访客户", "拜访", "2026-05-09", "07:30"),
  create("create_014", "明天下午5点半和财务确认打款", "财务", "2026-05-09", "17:30"),
  create("create_015", "下周五上午10点参加董事会", "董事会", "2026-05-15", "10:00"),
  create("create_016", "今晚8点半和同事讨论估值模型", "估值", "2026-05-08", "20:30"),
  create("create_017", "明天11点和券商沟通材料", "券商", "2026-05-09", "11:00"),
  create("create_018", "周日上午9点整理会议纪要", "会议纪要", "2026-05-10", "09:00"),
  create("create_019", "下周一下午1点半项目周会", "项目周会", "2026-05-11", "13:30"),
  create("create_020", "明天晚上7点投资人晚餐", "投资人", "2026-05-09", "19:00"),
  listCase("list_001", "查一下明天日程", "2026-05-09"),
  listCase("list_002", "我明天有什么安排", "2026-05-09"),
  listCase("list_003", "看看今晚的日程", "2026-05-08"),
  listCase("list_004", "查一下后天有没有会", "2026-05-10"),
  listCase("list_005", "看一下周一安排", "2026-05-11"),
  listCase("list_006", "明早有哪些事", "2026-05-09"),
  listCase("list_007", "下周二我都排了什么", "2026-05-12"),
  listCase("list_008", "今晚有没有饭局", "2026-05-08"),
  update("update_001", "把刚才那个会改成8点", "2026-05-09", "08:00"),
  update("update_002", "刚才那个饭局改到晚上9点", "2026-05-08", "21:00"),
  update("update_003", "刚才那个会标题改成投委会预沟通", undefined, undefined, "投委会"),
  update("update_004", "把刚才那个会议地点改到陆家嘴", undefined, undefined, undefined),
  update("update_005", "刚才那个路演改到下午4点", "2026-05-09", "16:00"),
  update("update_006", "刚才那个电话会改成和李总电话会", undefined, undefined, "李总"),
  update("update_007", "把刚才那个安排提前到早上7点半", "2026-05-09", "07:30"),
  update("update_008", "刚才那个董事会备注加上带财务模型", undefined, undefined, undefined),
  briefing("briefing_001", "早报", "morning"),
  briefing("briefing_002", "发我今天早上的日程总览", "morning"),
  briefing("briefing_003", "晚报", "evening"),
  briefing("briefing_004", "晚上帮我复盘一下明天安排", "evening"),
];

const BASIC_REGRESSION_TEXT_VARIANTS: Record<string, string[]> = {
  create_001: ["明天早上7点有个会，帮我记上"],
  create_002: ["今天晚上8点吃饭，记录一下"],
  create_003: ["明天9点跟张总开电话会"],
  create_004: ["明天下午3点见红杉王总，放到日历里"],
  create_005: ["后天上午10点投委会，记一下"],
  create_006: ["周一8点半和法务看协议"],
  create_007: ["下周二14点做路演彩排"],
  create_008: ["今晚21点复盘项目资料"],
  create_009: ["明天12点和刘总午餐"],
  create_010: ["明天午后2点跟IR团队开会"],
  create_011: ["后天下午16点看BP"],
  create_012: ["周三晚8点和基金LP吃饭"],
  create_013: ["明天早上7点半去拜访客户"],
  create_014: ["明天17点半和财务确认打款"],
  create_015: ["下周五10点董事会"],
  create_016: ["今晚20点半讨论估值模型"],
  create_017: ["明天上午11点和券商过材料"],
  create_018: ["周日早上9点整理会议纪要"],
  create_019: ["下周一13点半项目周会"],
  create_020: ["明天晚上19点投资人晚餐"],
  list_001: ["帮我看一下明天的日程"],
  list_002: ["明天我排了什么事"],
  list_003: ["看看今天晚上的安排"],
  list_004: ["查查后天有没有会议"],
  list_005: ["周一有什么安排"],
  list_006: ["明天早上有哪些事"],
  list_007: ["下周二我有哪些安排"],
  list_008: ["今晚是否有饭局"],
  update_001: ["把刚才那个会议改到8点"],
  update_002: ["刚才那个吃饭改到晚上9点"],
  update_003: ["把刚才那个会改名为投委会预沟通"],
  update_004: ["刚才那个会议地点换成陆家嘴"],
  update_005: ["把刚才那个路演挪到下午4点"],
  update_006: ["刚才那个电话会标题改成和李总电话会"],
  update_007: ["把刚才那个安排提前到7点半"],
  update_008: ["刚才那个董事会备注写上带财务模型"],
  briefing_001: ["给我今天早报"],
  briefing_002: ["发一份今天早上的日程总览"],
  briefing_003: ["给我晚报"],
  briefing_004: ["今晚帮我做一下明天安排复盘"],
};

export type SelectBasicRegressionCasesOptions = {
  stage?: BasicRegressionStage;
  seed?: string;
};

// 按阶段选择题组，并按 seed 轮换题面；阶段、分类、预期和状态保持稳定。
export function selectBasicRegressionCases(options?: string | SelectBasicRegressionCasesOptions): BasicRegressionCase[] {
  const normalized = typeof options === "string" ? { seed: options } : options || {};
  const stage = normalized.stage || "basic";
  const cases = basicRegressionCases.filter((testCase) => testCase.stage === stage);
  const seed = normalized.seed;
  if (!seed) return cases;

  return cases.map((testCase) => ({
    ...testCase,
    text: selectVariantText(testCase, seed),
  }));
}

function create(id: string, text: string, titleIncludes: string | string[], date: string, startTime: string): BasicRegressionCase {
  return { id, stage: "basic", text, expected: { type: "create_event", titleIncludes, date, startTime } };
}

function listCase(id: string, text: string, date: string): BasicRegressionCase {
  return { id, stage: "basic", text, expected: { type: "list_events", date } };
}

function update(
  id: string,
  text: string,
  date?: string,
  startTime?: string,
  titleIncludes?: string,
): BasicRegressionCase {
  return {
    id,
    stage: "basic",
    text,
    expected: { type: "update_event", date, startTime, titleIncludes },
    initialState: { last_event: { eventId: "evt_seed", title: "刚才的日程", ...(date ? { date } : {}) } },
  };
}

function briefing(id: string, text: string, briefingType: "morning" | "evening"): BasicRegressionCase {
  return { id, stage: "basic", text, expected: { type: "daily_briefing", briefingType } };
}

// 为每条样例选择同类不同表达，避免完整回归只记住固定句子。
function selectVariantText(testCase: BasicRegressionCase, seed: string): string {
  const variants = BASIC_REGRESSION_TEXT_VARIANTS[testCase.id] || [];
  if (variants.length === 0) return testCase.text;
  return variants[stableIndex(`${seed}:${testCase.id}`, variants.length)];
}

// 生成稳定下标；同一个 seed 可复现，不同 seed 会换题面。
function stableIndex(value: string, modulo: number): number {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % modulo;
}
