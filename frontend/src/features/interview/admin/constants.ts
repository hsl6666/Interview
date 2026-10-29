import type { LlmProvider, QuestionType, RiskLevel } from "../types";

export const DEFAULT_SYSTEM_PROMPT =
  "你是企业招聘场景中的笔试题生成智能体。你只生成结构化题目，不输出解释。题目要评估候选人的工程判断、代码能力、问题拆解能力和表达能力。";

export const questionTypeOptions: Array<{ label: string; value: QuestionType }> = [
  { label: "单选", value: "single" },
  { label: "多选", value: "multi" },
  { label: "简答", value: "short" },
  { label: "代码", value: "code" },
];

export const riskConfig: Record<RiskLevel, { label: string; color: string }> = {
  low: { label: "低风险", color: "green" },
  medium: { label: "中风险", color: "gold" },
  high: { label: "高风险", color: "red" },
};

export const providerOptions: Array<{ label: string; value: LlmProvider }> = [
  { label: "智谱 GLM", value: "zhipu" },
  { label: "OpenAI", value: "openai" },
  { label: "DeepSeek", value: "deepseek" },
  { label: "通义千问", value: "qwen" },
  { label: "自定义 OpenAI 兼容", value: "custom" },
];

export const providerDefaults: Record<LlmProvider, { model: string; api_base_url: string; models: string[] }> = {
  zhipu: { model: "glm-4.6", api_base_url: "https://open.bigmodel.cn/api/paas/v4", models: ["glm-4.6", "glm-4-plus", "glm-4-flash"] },
  openai: { model: "gpt-4o-mini", api_base_url: "https://api.openai.com/v1", models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1-mini"] },
  deepseek: {
    model: "deepseek-flash",
    api_base_url: "https://api.deepseek.com",
    models: ["deepseek-flash", "deepseek-v4-pro", "deepseek-chat", "deepseek-reasoner"],
  },
  qwen: {
    model: "qwen-plus",
    api_base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: ["qwen-plus", "qwen-max", "qwen-turbo"],
  },
  custom: { model: "", api_base_url: "", models: [] },
};
