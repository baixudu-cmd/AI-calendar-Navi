// 健康检查模块，只验证本地配置和旧系统边界，不访问真实外部服务。

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { type AppConfig, getConfigDiagnostics } from "../config/index.js";

export type HealthCheck = {
  name: "required_config" | "not_legacy_runtime" | "no_forbidden_legacy_references";
  ok: boolean;
  message: string;
};

export type HealthReport = {
  passed: number;
  failed: number;
  checks: HealthCheck[];
};

export type ForbiddenReference = {
  file: string;
  pattern: string;
};

const LEGACY_RUNTIME_NAME = `${"tracklog"}-${"agent"}`;
const LEGACY_RUNTIME_PATH =
  process.env.NAVI_LEGACY_RUNTIME_PATH ||
  resolve(homedir(), "projects", "codex-workspaces", LEGACY_RUNTIME_NAME);
const FORBIDDEN_PATTERNS = [
  `${"tracklog"}-${"agent"}`,
  `${"navi"}-${"core"}`,
  `${"navi"} ${"prompt"}`,
  `${"seed"} ${"scheduler"}`,
  `${"trigger"} ${"engine"}`,
  `${"state"} ${"restore"}`,
];

// 扫描源码和测试，阻止旧 Navi 业务链路进入新版。
export function scanForForbiddenLegacyReferences(
  projectRoot: string,
  scanDirs: string[] = ["src", "tests"],
): ForbiddenReference[] {
  const findings: ForbiddenReference[] = [];

  for (const dir of scanDirs) {
    const absoluteDir = resolve(projectRoot, dir);
    if (!existsSync(absoluteDir)) continue;
    scanDirectory(absoluteDir, findings);
  }

  return findings;
}

// 运行 Phase 1 健康检查。
export function runHealthChecks(input: {
  projectRoot: string;
  config: AppConfig;
  scanDirs?: string[];
}): HealthReport {
  const diagnostics = getConfigDiagnostics(input.config);
  const forbiddenReferences = scanForForbiddenLegacyReferences(input.projectRoot, input.scanDirs);
  const isLegacyRuntime = isInsidePath(input.projectRoot, LEGACY_RUNTIME_PATH);
  const checks: HealthCheck[] = [
    {
      name: "required_config",
      ok: diagnostics.missing.length === 0,
      message:
        diagnostics.missing.length === 0
          ? "必需配置已设置。"
          : `缺少配置：${diagnostics.missing.join(", ")}`,
    },
    {
      name: "not_legacy_runtime",
      ok: !isLegacyRuntime,
      message:
        isLegacyRuntime
          ? `当前路径是旧 ${LEGACY_RUNTIME_NAME}，不能作为新版运行目录。`
          : `当前路径不是旧 ${LEGACY_RUNTIME_NAME}。`,
    },
    {
      name: "no_forbidden_legacy_references",
      ok: forbiddenReferences.length === 0,
      message:
        forbiddenReferences.length === 0
          ? "未发现旧 Navi 业务引用。"
          : `发现旧引用 ${forbiddenReferences.length} 处：${formatFindings(input.projectRoot, forbiddenReferences)}`,
    },
  ];

  return {
    passed: checks.filter((check) => check.ok).length,
    failed: checks.filter((check) => !check.ok).length,
    checks,
  };
}

// 格式化健康检查结果，保持简短且不泄露密钥。
export function formatHealthReport(report: HealthReport): string {
  const lines = [`Health checks: passed ${report.passed}, failed ${report.failed}`];
  for (const check of report.checks) {
    lines.push(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.message}`);
  }
  return lines.join("\n");
}

// 递归读取可执行代码文件，匹配禁止继承的旧系统标记。
function scanDirectory(dir: string, findings: ForbiddenReference[]) {
  for (const entry of readdirSync(dir)) {
    const path = resolve(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      scanDirectory(path, findings);
      continue;
    }
    if (!path.endsWith(".ts") && !path.endsWith(".tsx") && !path.endsWith(".js")) continue;

    const content = readFileSync(path, "utf8");
    const lowerContent = content.toLowerCase();
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (lowerContent.includes(pattern)) {
        findings.push({ file: path, pattern });
      }
    }
  }
}

// 判断当前路径是否落在禁止运行的旧目录内。
function isInsidePath(candidatePath: string, parentPath: string): boolean {
  const relativePath = relative(resolve(parentPath), resolve(candidatePath));
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

// 输出相对文件名和数量，避免把本机绝对路径打印出去。
function formatFindings(projectRoot: string, findings: ForbiddenReference[]): string {
  return findings
    .map((item) => {
      const relativeFile = relative(resolve(projectRoot), item.file).split(sep).join("/");
      return `${relativeFile}:${item.pattern}`;
    })
    .join(", ");
}
