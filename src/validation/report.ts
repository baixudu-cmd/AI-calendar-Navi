// 验证报告格式化：只输出通过/失败数量和失败问题族。

export type ValidationProblemFamily = {
  name: string;
  failed: number;
};

export type ValidationReportInput = {
  passed: number;
  failed: number;
  families: ValidationProblemFamily[];
};

// 生成简短验证报告，避免逐条展开用例。
export function formatValidationReport(input: ValidationReportInput): string {
  const lines = [`Validation: passed ${input.passed}, failed ${input.failed}`];
  for (const family of input.families) {
    if (family.failed > 0) lines.push(`FAIL ${family.name}: ${family.failed}`);
  }
  return lines.join("\n");
}
