// 读取本机环境配置，并提供不会泄露密钥的诊断信息。

export type EnvSource = Record<string, string | undefined>;

export type AppConfig = {
  appName: string;
  timezone: string;
  modelProvider?: string;
  modelBaseUrl?: string;
  modelApiKey?: string;
  modelName?: string;
  feishuAppId?: string;
  feishuAppSecret?: string;
  feishuCalendarId: string;
  feishuTestCalendarId?: string;
  feishuMainCalendarId?: string;
  feishuDefaultAttendeeOpenId?: string;
  openclawWorkspace?: string;
  wechatEntrySecret?: string;
};

export type ConfigDiagnostics = {
  missing: string[];
  values: Record<string, string>;
};

const REQUIRED_KEYS = [
  "MODEL_PROVIDER",
  "MODEL_BASE_URL",
  "MODEL_API_KEY",
  "MODEL_NAME",
  "FEISHU_APP_ID",
  "FEISHU_APP_SECRET",
  "OPENCLAW_WORKSPACE",
  "WECHAT_ENTRY_SECRET",
] as const;

const SECRET_KEYS = new Set(["MODEL_API_KEY", "FEISHU_APP_SECRET", "WECHAT_ENTRY_SECRET", "FEISHU_DEFAULT_ATTENDEE_OPEN_ID"]);

// 从环境变量中读取配置；没有值时只设置安全默认值。
export function loadConfig(env: EnvSource = process.env): AppConfig {
  return {
    appName: env.APP_NAME || "minical-agent",
    timezone: env.TIMEZONE || "Asia/Shanghai",
    modelProvider: env.MODEL_PROVIDER,
    modelBaseUrl: env.MODEL_BASE_URL,
    modelApiKey: env.MODEL_API_KEY,
    modelName: env.MODEL_NAME,
    feishuAppId: env.FEISHU_APP_ID,
    feishuAppSecret: env.FEISHU_APP_SECRET,
    feishuCalendarId: env.FEISHU_CALENDAR_ID || "primary",
    feishuTestCalendarId: env.FEISHU_TEST_CALENDAR_ID,
    feishuMainCalendarId: env.FEISHU_MAIN_CALENDAR_ID,
    feishuDefaultAttendeeOpenId: env.FEISHU_DEFAULT_ATTENDEE_OPEN_ID,
    openclawWorkspace: env.OPENCLAW_WORKSPACE,
    wechatEntrySecret: env.WECHAT_ENTRY_SECRET,
  };
}

// 生成配置诊断，所有密钥只显示是否已设置。
export function getConfigDiagnostics(config: AppConfig): ConfigDiagnostics {
  const rawValues: Record<string, string | undefined> = {
    APP_NAME: config.appName,
    TIMEZONE: config.timezone,
    MODEL_PROVIDER: config.modelProvider,
    MODEL_BASE_URL: config.modelBaseUrl,
    MODEL_API_KEY: config.modelApiKey,
    MODEL_NAME: config.modelName,
    FEISHU_APP_ID: config.feishuAppId,
    FEISHU_APP_SECRET: config.feishuAppSecret,
    FEISHU_CALENDAR_ID: config.feishuCalendarId,
    FEISHU_TEST_CALENDAR_ID: config.feishuTestCalendarId,
    FEISHU_MAIN_CALENDAR_ID: config.feishuMainCalendarId,
    FEISHU_DEFAULT_ATTENDEE_OPEN_ID: config.feishuDefaultAttendeeOpenId,
    OPENCLAW_WORKSPACE: config.openclawWorkspace,
    WECHAT_ENTRY_SECRET: config.wechatEntrySecret,
  };

  const missing = REQUIRED_KEYS.filter((key) => !rawValues[key]);
  const values = Object.fromEntries(
    Object.entries(rawValues).map(([key, value]) => {
      if (!value) return [key, "[missing]"];
      if (SECRET_KEYS.has(key)) return [key, "[set]"];
      return [key, value];
    }),
  );

  return { missing, values };
}
