import { useEffect, useState } from "react";
import { ApiOutlined, SaveOutlined, SyncOutlined } from "@ant-design/icons";
import { Alert, Button, Checkbox, Form, Input, Select, Space, Switch, Tag, message } from "antd";
import { fetchAdminModelConfig, updateAdminModelConfig, testAdminModelConnection } from "../../api";
import { providerDefaults, providerOptions } from "../constants";
import type { LlmModelConfig, LlmModelConfigUpdate, LlmProvider, ModelConnectionResult } from "../../types";

type ModelConfigFormValues = LlmModelConfigUpdate & { api_key: string };

export default function ModelManagementPage() {
  const [form] = Form.useForm<ModelConfigFormValues>();
  const [config, setConfig] = useState<LlmModelConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [connection, setConnection] = useState<ModelConnectionResult | null>(null);
  const [testError, setTestError] = useState("");
  const busy = loading || saving || testing;
  function markDirty() { setDirty(true); setConnection(null); setTestError(""); }
  const provider = Form.useWatch("provider", form) || "zhipu";
  const currentDefaults = providerDefaults[provider as LlmProvider] || providerDefaults.custom;

  useEffect(() => {
    void loadConfig();
  }, []);

  async function loadConfig() {
    setLoading(true);
    try {
      const data = await fetchAdminModelConfig();
      setConfig(data);
      setDirty(false); setConnection(null); setTestError("");
      form.setFieldsValue({
        provider: data.provider,
        model: data.model,
        api_base_url: data.api_base_url,
        api_key: "",
        enabled: data.enabled,
        clear_api_key: false,
      });
    } catch {
      message.error("加载模型配置失败，请确认后端服务可用");
    } finally {
      setLoading(false);
    }
  }

  function applyProviderDefaults(nextProvider: LlmProvider) {
    const defaults = providerDefaults[nextProvider];
    markDirty();
    form.setFieldsValue({
      provider: nextProvider,
      model: defaults.model,
      api_base_url: defaults.api_base_url,
    });
  }

  async function saveConfig() {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const payload: LlmModelConfigUpdate = {
        provider: values.provider,
        model: values.model,
        api_base_url: values.api_base_url,
        enabled: values.enabled,
        clear_api_key: values.clear_api_key,
      };
      if (values.api_key?.trim()) payload.api_key = values.api_key.trim();
      const next = await updateAdminModelConfig(payload);
      setConfig(next);
      setDirty(false); setConnection(null); setTestError("");
      form.setFieldsValue({ api_key: "", clear_api_key: false });
      message.success("模型配置已保存");
    } catch {
      message.error("保存模型配置失败");
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true); setConnection(null); setTestError("");
    try {
      setConnection(await testAdminModelConnection());
    } catch {
      setTestError("检测请求未完成，请确认后端在线后重试。");
    } finally { setTesting(false); }
  }

  return (
    <div className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="min-w-0 rounded-lg border border-stone-200 bg-white p-5">
        <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-lg font-semibold">全局模型配置</h2>
            <p className="mt-1 text-sm text-stone-500">题目生成智能体和后端 LLM 调用会优先使用这里的配置。</p>
          </div>
          <Button icon={<SyncOutlined />} onClick={() => void loadConfig()} loading={loading} disabled={saving || testing}>
            重新加载
          </Button>
        </div>

        <Form form={form} layout="vertical" initialValues={{ provider: "zhipu", enabled: false, clear_api_key: false }} disabled={busy} onValuesChange={markDirty}>
          <div className="grid gap-4 md:grid-cols-2">
            <Form.Item label="模型厂商" name="provider" rules={[{ required: true, message: "请选择模型厂商" }]}>
              <Select options={providerOptions} onChange={(value: LlmProvider) => applyProviderDefaults(value)} />
            </Form.Item>
            <Form.Item label="启用状态" name="enabled" valuePropName="checked">
              <Switch checkedChildren="启用" unCheckedChildren="停用" />
            </Form.Item>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Form.Item label="模型" name="model" rules={[{ required: true, message: "请输入或选择模型" }]}>
              <Select
                showSearch
                allowClear
                placeholder="选择或输入模型名"
                options={currentDefaults.models.map((item) => ({ label: item === "deepseek-flash" ? "DeepSeek V4.1 Flash（deepseek-flash）" : item, value: item }))}
                dropdownRender={(menu) => (
                  <>
                    {menu}
                    <div className="border-t border-stone-100 px-3 py-2 text-xs text-stone-500">没有目标模型时，可直接在输入框键入模型名。</div>
                  </>
                )}
                onSearch={(value) => {
                  if (value) { form.setFieldValue("model", value); markDirty(); }
                }}
              />
            </Form.Item>
            <Form.Item label="Base URL" name="api_base_url" rules={[{ required: true, message: "请输入 Base URL" }]}>
              <Input placeholder="https://api.example.com/v1" />
            </Form.Item>
          </div>

          <Form.Item
            label="API Key"
            name="api_key"
            extra={config?.has_api_key ? `当前已配置：${config.api_key_masked}。留空保存会保留原 Key。` : "当前未配置 Key。"}
          >
            <Input.Password placeholder="请输入新的 API Key" autoComplete="new-password" />
          </Form.Item>

          <Form.Item name="clear_api_key" valuePropName="checked">
            <Checkbox>清空已保存的 API Key</Checkbox>
          </Form.Item>

          <Space wrap>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void saveConfig()}>
              保存全局配置
            </Button>
            <Button icon={<ApiOutlined />} loading={testing} disabled={busy || dirty || !config} onClick={() => void testConnection()}>
              检测连接
            </Button>
            <Button onClick={() => applyProviderDefaults(provider as LlmProvider)}>恢复当前厂商默认值</Button>
          </Space>
          <p className="mt-3 text-xs text-stone-500">{dirty ? "有未保存的修改，请先保存全局配置，再检测连接。" : "检测已保存的配置，发送一条简短测试请求，不携带候选人资料。"}</p>
        </Form>
      </section>

      <aside className="min-w-0 space-y-4">
        {testing && <Alert type="info" showIcon title="正在检测模型连接…" description="通常几秒完成，最长等待约20秒。" />}
        {testError && <Alert type="error" showIcon title="连接检测未完成" description={testError} />}
        {connection && <Alert type={connection.success ? "success" : "error"} showIcon title={connection.success ? "连接检测成功" : "连接检测失败"} description={<div><p>{connection.message}</p><p className="mt-2">模型：{connection.model} · 耗时：{connection.latency_ms} ms{connection.http_status ? ` · HTTP ${connection.http_status}` : ""}</p></div>} />}

        <section className="min-w-0 rounded-lg border border-stone-200 bg-white p-5">
          <h3 className="font-semibold">当前状态</h3>
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-stone-500">厂商</span>
              <Tag>{config?.provider || "-"}</Tag>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-stone-500">模型</span>
              <span className="max-w-[70%] break-all text-right font-medium">{config?.model || "-"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-stone-500">Key</span>
              <Tag color={config?.has_api_key ? "green" : "red"}>{config?.has_api_key ? "已配置" : "未配置"}</Tag>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-stone-500">启用</span>
              <Tag color={config?.enabled ? "green" : "default"}>{config?.enabled ? "启用" : "停用"}</Tag>
            </div>
          </div>
        </section>
        <Alert
          type="warning"
          showIcon
          title="Key 不会明文展示"
          description="后台保存后只返回脱敏 Key。更换 Key 时填写新值；不填写会保留旧值；勾选清空会删除旧值。"
        />
      </aside>
    </div>
  );
}
