// 验证报告测试：确认汇报只包含数量和问题族，不展开单条用例。

import { describe, expect, it } from "vitest";
import { formatValidationReport } from "../src/validation/report.js";

describe("formatValidationReport", () => {
  it("summarizes passed and failed counts without listing every case", () => {
    expect(
      formatValidationReport({
        passed: 5,
        failed: 2,
        families: [
          { name: "缺槽追问", failed: 1 },
          { name: "日报内修改", failed: 1 },
        ],
      }),
    ).toBe("Validation: passed 5, failed 2\nFAIL 缺槽追问: 1\nFAIL 日报内修改: 1");
  });

  it("prints a short all-pass report", () => {
    expect(formatValidationReport({ passed: 6, failed: 0, families: [] })).toBe("Validation: passed 6, failed 0");
  });
});
