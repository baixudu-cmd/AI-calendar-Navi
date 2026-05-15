// 进阶真实压测题面变体：只替换用户表达，不改变场景、预期或 fake calendar 合同。

import {
  advancedRegressionScenarios,
  type AdvancedRegressionScenario,
  type AdvancedRegressionStep,
} from "./advanced-regression-cases.js";

export type SelectAdvancedRegressionScenariosOptions = {
  seed?: string;
};

// 按 seed 选择进阶题面；不传 seed 时保持原始题库，便于复现旧验证结果。
export function selectAdvancedRegressionScenarios(
  options?: SelectAdvancedRegressionScenariosOptions,
): AdvancedRegressionScenario[] {
  if (!options?.seed) return advancedRegressionScenarios;
  return advancedRegressionScenarios.map((scenario) => ({
    ...scenario,
    steps: scenario.steps.map((step, stepIndex) => ({
      ...step,
      text: selectAdvancedStepText(scenario, step, stepIndex, options.seed || ""),
    })),
  }));
}

// 为单个步骤生成同义题面，确保核心时间、标题和选择指令不漂移。
function selectAdvancedStepText(
  scenario: AdvancedRegressionScenario,
  step: AdvancedRegressionStep,
  stepIndex: number,
  seed: string,
): string {
  const variants = getAdvancedStepVariants(scenario, step, stepIndex);
  if (variants.length === 0) return step.text;
  return variants[stableIndex(`${seed}:${scenario.id}:${stepIndex}`, variants.length)];
}

// 根据题目类型生成变体，避免在测试文件里散落大量硬编码句子。
function getAdvancedStepVariants(
  scenario: AdvancedRegressionScenario,
  step: AdvancedRegressionStep,
  stepIndex: number,
): string[] {
  if (scenario.category === "briefing_title_update") {
    if (stepIndex === 0) return ["今天早报给我看一下"];
    return [`第一条标题改成${extractAfter(step.text, "把第1条改成")}`];
  }

  if (scenario.category === "briefing_time_update") {
    if (stepIndex === 0) return ["今天日程早报给我看一下"];
    return [`第一条时间换成${extractAfter(step.text, "把第1条改到")}`];
  }

  if (scenario.category === "evening_briefing_update") {
    if (stepIndex === 0) return ["今晚帮我整理一下明天安排"];
    return [rewriteIndexedUpdate(step.text)];
  }

  if (scenario.category === "last_event_time_update") {
    return [rewriteLastEventTime(step.text)];
  }

  if (scenario.category === "last_event_title_update") {
    return [rewriteLastEventTitle(step.text)];
  }

  if (scenario.category === "delete_confirm" || scenario.category === "delete_cancel") {
    return [rewriteDeleteStep(step.text, scenario.category)];
  }

  if (scenario.category === "create_draft_clarification") {
    return [rewriteCreateDraftStep(step.text)];
  }

  if (scenario.category === "batch_create_context") {
    return [rewriteBatchCreateStep(step.text)];
  }

  if (scenario.category === "mixed_create_schedule") {
    if (scenario.id === "advanced_mixed_create_schedule_002") {
      return ["周六10点湛湛游泳，下午跟 hanqi 吃饭再去奥莱，你一起处理一下"];
    }
    if (step.text === "周六上午9点足球课，下午整理玩具和买生日礼物") {
      return ["周六9点足球课，下午把整理玩具和买生日礼物也帮我安排"];
    }
    if (step.text === "明天上午10点路演彩排，下午安排写反馈邮件") {
      return ["明天10点路演彩排，下午写反馈邮件也排一下"];
    }
    return ["周六10点澄澄游泳，下午跟 hanqi 吃饭再去奥莱，你一起处理一下"];
  }

  if (scenario.category === "schedule_context") {
    return [rewriteScheduleStep(step.text)];
  }

  if (scenario.category === "todo_auto_schedule") {
    return [rewriteTodoAutoScheduleStep(step.text)];
  }

  if (scenario.category === "todo_inbox_management") {
    return [rewriteTodoInboxStep(step.text)];
  }

  return [];
}

// 改写早晚报里的第几条修改表达。
function rewriteIndexedUpdate(text: string): string {
  if (text.startsWith("把第1条改成")) return `第一条标题改成${extractAfter(text, "把第1条改成")}`;
  if (text.startsWith("把第1条改到")) return `第一条时间换成${extractAfter(text, "把第1条改到")}`;
  return text;
}

// 改写“刚才那条改时间”的口语表达。
function rewriteLastEventTime(text: string): string {
  const match = text.match(/(?:改到|提前到|这个挪到|时间改成)(.+)$/);
  if (!match) return text;
  return `刚才那个时间换成${match[1]}`;
}

// 改写“刚才那条改标题”的口语表达。
function rewriteLastEventTitle(text: string): string {
  if (text.startsWith("标题改成")) return `刚才那个标题换成${extractAfter(text, "标题改成")}`;
  if (text.startsWith("刚才那个改成")) return `刚才那个标题换成${extractAfter(text, "刚才那个改成")}`;
  if (text.startsWith("名字改成")) return `刚才那个名字改成${extractAfter(text, "名字改成")}`;
  if (text.startsWith("这条改成")) return `这条标题换成${extractAfter(text, "这条改成")}`;
  if (text.startsWith("刚才那个叫")) return `刚才那个标题换成${extractAfter(text, "刚才那个叫")}`;
  return text;
}

// 改写删除请求和确认/取消回复。
function rewriteDeleteStep(text: string, category: "delete_confirm" | "delete_cancel"): string {
  if (text === "删掉刚才那个") return "刚刚那条帮我删掉";
  if (text === "删掉第1条") return "第一条不要了";
  if (text === "确认删除") return "OK，删吧";
  if (text === "取消") return category === "delete_cancel" ? "先别删了" : text;
  return text;
}

// 改写补时间草稿链路，保持同一个待补信息。
function rewriteCreateDraftStep(text: string): string {
  if (text === "明天约张总开会") return "帮我明天约张总开会";
  if (text === "明天安排一个项目复盘") return "明天加一个项目复盘";
  if (text === "今天加一个材料会") return "今天帮我放一个材料会";
  if (text === "明天和产品聊一下") return "明天和产品聊一下，先帮我记个日程";
  if (text === "周六安排一下家庭复盘") return "周六加一个家庭复盘";
  if (text === "今天要和财务过一下口径") return "今天和财务过口径，帮我放日历";
  if (text === "查一下明天日程") return "明天日程给我看一下";
  if (text === "算了，先不管了") return "先算了，不处理这个了";
  if (text.includes("点")) return `就${text}`;
  return text;
}

// 改写批量创建和后续第二条修改表达。
function rewriteBatchCreateStep(text: string): string {
  if (text.includes("都帮我记一下")) return text.replace("都帮我记一下", "都加到日历里");
  if (text.includes("都加上")) return text.replace("都加上", "都放进日历");
  if (text.includes("一起记一下")) return text.replace("一起记一下", "一起加到日历");
  if (text.includes("都放进日历")) return text.replace("都放进日历", "都帮我记一下");
  if (text.startsWith("把第二个")) return text.replace("把第二个", "第二条");
  if (text.startsWith("把第2条")) return text.replace("把第2条", "第二条");
  if (text.startsWith("把第二条")) return text.replace("把第二条", "第二条");
  if (text.startsWith("把第一个")) return text.replace("把第一个", "第一条");
  if (text.startsWith("第三个")) return text.replace("第三个", "第三条");
  if (text.startsWith("第二条标题改成")) return text.replace("第二条标题改成", "把第二条改成");
  return text;
}

// 改写排程推荐上下文，重点覆盖选择、单项改时间和多项对应修改。
function rewriteScheduleStep(text: string): string {
  if (text === "明天帮我安排看锐盟材料，推荐几个时间") return "明天看锐盟材料，帮我挑几个可用时间";
  if (text === "选第二个") return "就第二个吧";
  if (text === "选第三个") return "第三个吧";
  if (text === "第2个吧") return "第二个可以";
  if (text === "选第一个") return "第一个可以";
  if (text === "第一个就行") return "就第一个吧";
  if (text === "明天帮我找个时间看 DCF 模型") return "明天看 DCF 模型，你帮我排个合适时间";
  if (text === "改成 11 点") return "那就放 11 点";
  if (text === "明天帮我安排看材料和写邮件，给我推荐时间") return "明天看材料、写邮件这两件事，你帮我推荐下时间";
  if (text === "第一个改 11 点，第二个改下午 3 点") return "看材料放 11 点，写邮件放下午 3 点";
  if (text === "明天帮我安排整理投委会材料，先推荐几个时间") return "明天整理投委会材料，你帮我挑几个时间";
  if (text === "换下午再给我几个") return "上午不太行，换下午看看";
  if (text === "今天帮我推荐个时间处理拿币") return "今天处理拿币，帮我推荐一个可用时间";
  if (text === "今天太满，明天吧") return "今天先算了，放明天重新推荐";
  if (text === "明天把看项目资料排一下，推荐时间") return "明天看项目资料，你帮我排一下";
  if (text === "晚一点再推荐") return "往后一点再给我几个";
  if (text === "第一个可以") return "第一个就行";
  if (text === "明天帮我安排看商业计划书，给我5个候选") return "明天看商业计划书，帮我挑 5 个时间";
  if (text === "明天把写投资 memo 排一下，给我2个候选") return "明天写投资 memo，给我两个可选时间";
  if (text === "明天把整理会议纪要排一下，推荐时间") return "明天整理会议纪要，帮我推荐时间";
  if (text === "明天把找律师和更新模型排一下") return "明天找律师、更新模型这两件事帮我排一下";
  if (text === "第一个10点，第二个11点") return "找律师放10点，更新模型放11点";
  if (text === "明天帮我排一下看法律条款") return "明天看法律条款，你帮我找个空档";
  if (text === "明天下午帮我安排复盘预算，不要上午") return "明天复盘预算不要上午，放下午推荐";
  if (text === "帮我安排一下写周报") return "写周报这件事你帮我找个时间";
  if (text === "今天帮我安排一个新事项：整理材料") return "今天整理材料，帮我重新排一个时间";
  if (text === "不是这个，帮我给处理发票推荐几个时间") return "先别管那个，处理发票帮我推荐几个时间";
  if (text === "把第一个和第二个安排一下") return "第1个和第2个都帮我排时间";
  return text;
}

// 改写自然待办自动排程表达，保持事项标题不漂移。
function rewriteTodoAutoScheduleStep(text: string): string {
  if (text === "把拿币的事项弄完") return "拿币这个事帮我弄完";
  if (text === "拿币那个事先处理一下") return "把拿币先处理一下";
  if (text === "把财务口径弄完") return "财务口径这件事帮我处理掉";
  if (text === "DCF模型先处理一下") return "先把 DCF 模型处理一下";
  if (text === "帮我把写邮件搞定") return "写邮件这事帮我搞定";
  if (text === "处理一下收购清单") return "收购清单先处理一下";
  if (text === "把路演反馈收尾") return "路演反馈帮我收个尾";
  return text;
}

// 改写待推进收件箱管理表达，覆盖查看、完成、取消和延期。
function rewriteTodoInboxStep(text: string): string {
  if (text === "我还有哪些待推进？") return "现在还有什么待推进的";
  if (text === "拿币那个完成了") return "拿币这件事已经搞定了";
  if (text === "第二个先别提醒了") return "第2个不用提醒了";
  if (text === "把第一个改成下周处理") return "第一条挪到下周再处理";
  if (text === "第一个和第三个都完成了") return "第1个和第3个都搞定了";
  if (text === "第二个不用再记了") return "第2个从待推进里去掉";
  if (text === "第二个明天下午提醒我") return "第2个明天下午记得提醒我";
  if (text === "今天只看最重要的3个") return "只给我看前三个待推进";
  if (text === "把第一个改名成整理锐盟 DCF") return "第一条标题换成整理锐盟 DCF";
  if (text === "前两个都完成了") return "第1个第2个都搞定了";
  if (text === "整理 DCF 先取消") return "整理 DCF 这个先别记了";
  if (text === "第一条明天处理") return "第1条放到明天处理";
  if (text === "第一个和第二个先别提醒了") return "第1个第2个都不用提醒";
  if (text === "把第二个改成下周一处理") return "第2个挪到下周一处理";
  if (text === "现在还有什么没处理") return "待推进里现在还有什么";
  return text;
}

// 提取固定前缀后的内容，前缀不匹配时保守返回原文。
function extractAfter(text: string, prefix: string): string {
  return text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

// 生成稳定下标，保证同一个 seed 的换题结果可复现。
function stableIndex(value: string, modulo: number): number {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % modulo;
}
