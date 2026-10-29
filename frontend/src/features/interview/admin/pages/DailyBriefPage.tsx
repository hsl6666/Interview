import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, Col, Drawer, Empty, Form, Input, message, Row, Space, Statistic, Switch, Table, Tag, Typography } from "antd";
import { ClockCircleOutlined, EyeOutlined, ReloadOutlined, SendOutlined } from "@ant-design/icons";
import axios from "axios";
import { API_BASE_URL } from "../../api";
import { getApiErrorMessage } from "../utils";

const api = axios.create({ baseURL: `${API_BASE_URL}/api/admin/daily-brief`, timeout: 90_000 });
type Config = { enabled: boolean; ai_enabled: boolean; group_name: string; mention_name: string; mention_user_id: string; has_webhook: boolean; has_signing_secret: boolean };
type Run = { id: string; report_date: string; kind: string; status: string; content: string; summary_mode: string; error: string; target_group: string; mention_name: string; created_at: string; sent_at: string | null };
type Preview = { content: string; summary_mode: string; facts: { total: number; completed: number; cutoff: string } };
const statuses: Record<string, { text: string; color: string }> = { sent: { text: "发送成功", color: "success" }, failed: { text: "发送失败", color: "error" }, unknown: { text: "待核对群消息", color: "warning" }, generating: { text: "生成中", color: "processing" }, sending: { text: "发送中", color: "processing" } };
const modes: Record<string, string> = { ai: "AI 归纳", facts: "事实摘要", fallback: "AI 不可用，已降级" };
const localTime = (value: string) => new Date(/Z$|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });

export default function DailyBriefPage() {
  const [form] = Form.useForm();
  const [config, setConfig] = useState<Config>();
  const [runs, setRuns] = useState<Run[]>([]);
  const [preview, setPreview] = useState<Preview>();
  const [detail, setDetail] = useState<Run>();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const load = useCallback(async () => {
    try {
      const [c, r] = await Promise.all([api.get<Config>("/config"), api.get<Run[]>("/runs")]);
      setConfig(c.data); setRuns(r.data); form.setFieldsValue({ ...c.data, webhook_url: "", signing_secret: "" }); setDirty(false); setError("");
    } catch (e) { setError(getApiErrorMessage(e)); }
  }, [form]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => { void api.get<Run[]>("/runs").then(r => setRuns(r.data)).catch(() => undefined); }, 15_000);
    return () => window.clearInterval(timer);
  }, []);
  async function save() {
    try {
      const values = await form.validateFields(); setBusy("save");
      const { data } = await api.put<Config>("/config", values);
      setConfig(data); form.setFieldsValue({ webhook_url: "", signing_secret: "" }); setDirty(false); message.success("已保存简报配置");
    } catch (e) { message.error(getApiErrorMessage(e)); } finally { setBusy(""); }
  }
  async function generate() {
    setBusy("preview");
    try { setPreview((await api.post<Preview>("/preview")).data); } catch (e) { message.error(getApiErrorMessage(e)); } finally { setBusy(""); }
  }
  async function send(test: boolean, retry = false) {
    setBusy(test ? "test" : "send");
    try {
      const { data } = await api.post<Run>("/send", { test, retry });
      setDetail(data);
      if (data.status === "sent") message.success(test ? "测试消息已发送，请确认群内 @ 提醒" : "今日简报已发送（已发送时不重复推送）");
      else message.warning(data.error || "任务正在处理中");
      setRuns((await api.get<Run[]>("/runs")).data);
    } catch (e) { message.error(getApiErrorMessage(e)); } finally { setBusy(""); }
  }
  const canSend = Boolean(config?.has_webhook && config?.mention_user_id && !dirty);
  return <Space orientation="vertical" size={24} style={{ width: "100%" }}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><Typography.Title level={3} style={{ margin: 0 }}>每日面试简报</Typography.Title><Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>汇总当天面试进展，归纳作答证据，让团队及时跟进候选人。</Typography.Paragraph></div>
      <Tag color={config?.enabled ? "green" : "default"} icon={<ClockCircleOutlined />}>{config?.enabled ? "定时推送已开启" : "定时推送未开启"} · 每日 18:00</Tag>
    </div>
    {error && <Alert type="error" title="加载失败" description={error} action={<Button onClick={() => void load()}>重试</Button>} />}
    <Alert showIcon type="info" title="北京时间 18:00 自动汇总并推送" description="统计当天零点至生成时有活动的面试会话。后台服务须持续运行并联网；当日18点后恢复运行会补发当天简报，历史日期不自动补发。18点后新增活动不包含在当天已发送的简报中。" />
    <Row gutter={[20,20]}>
      <Col xs={24} xl={10}><Card title="推送设置">
        <Form form={form} layout="vertical" onValuesChange={() => setDirty(true)} disabled={!config || Boolean(busy)}>
          <Form.Item name="enabled" label="每日自动推送" valuePropName="checked"><Switch checkedChildren="开启" unCheckedChildren="关闭" /></Form.Item>
          <Form.Item name="ai_enabled" label="AI 总结归纳" valuePropName="checked" extra="使用模型管理中启用的模型；不可用时发送事实摘要。"><Switch checkedChildren="开启" unCheckedChildren="关闭" /></Form.Item>
          <Row gutter={12}><Col span={12}><Form.Item name="group_name" label="目标群名称" rules={[{ required: true }]} extra="以 Webhook 所属群为准"><Input maxLength={120} /></Form.Item></Col><Col span={12}><Form.Item name="mention_name" label="提醒对象" rules={[{ required: true }]}><Input maxLength={120} /></Form.Item></Col></Row>
          <Form.Item name="mention_user_id" label="提醒对象 User ID / Open ID" extra="姓名不能触发真实 @；需填写何松林在飞书中的成员 ID。"><Input placeholder="例如 ou_… 或用户 ID" autoComplete="off" /></Form.Item>
          <Form.Item name="webhook_url" label="飞书机器人 Webhook" extra={config?.has_webhook ? "已保存，留空保留原值；凭证不回显。" : "在目标群 → 群机器人 → 自定义机器人中获取。"}><Input.Password placeholder={config?.has_webhook ? "已配置，输入可替换" : "https://open.feishu.cn/open-apis/bot/v2/hook/…"} autoComplete="new-password" /></Form.Item>
          <Form.Item name="signing_secret" label="签名密钥（可选）" extra={config?.has_signing_secret ? "已配置，留空保留原值。" : "机器人开启签名校验时填写。"}><Input.Password placeholder={config?.has_signing_secret ? "已配置，输入可替换" : "飞书签名校验密钥"} autoComplete="new-password" /></Form.Item>
          <Space wrap><Button type="primary" onClick={() => void save()} loading={busy === "save"}>保存配置</Button><Button icon={<SendOutlined />} disabled={!canSend || Boolean(busy)} onClick={() => void send(true)} loading={busy === "test"}>发送连接测试</Button></Space>
          {dirty && <Typography.Paragraph type="secondary" style={{ marginTop: 10 }}>有未保存修改，请先保存再预览或推送。</Typography.Paragraph>}
        </Form>
      </Card></Col>
      <Col xs={24} xl={14}><Card title="今日简报预览" extra={<Button icon={<ReloadOutlined />} disabled={Boolean(busy) || dirty} loading={busy === "preview"} onClick={() => void generate()}>生成预览</Button>}>
        {preview ? <><Row gutter={16}><Col span={12}><Statistic title="今日有活动" value={preview.facts.total} suffix="场" /></Col><Col span={12}><Statistic title="流程已完成" value={preview.facts.completed} suffix="场" /></Col></Row><Tag style={{ marginTop: 16 }}>{modes[preview.summary_mode]}</Tag><Typography.Paragraph style={{ whiteSpace: "pre-wrap", marginTop: 16, maxHeight: 410, overflow: "auto" }}>{preview.content}</Typography.Paragraph></> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="生成预览后查看统计与归纳，不会发送群消息" />}
        <Space wrap><Button type="primary" icon={<SendOutlined />} disabled={!canSend || !preview || Boolean(busy)} loading={busy === "send"} onClick={() => void send(false)}>立即发送今日简报</Button><Typography.Text type="secondary">发送时按最新数据生成；当日已发送则不重复。</Typography.Text></Space>
      </Card></Col>
    </Row>
    <Card title="发送记录" extra={<Button icon={<ReloadOutlined />} disabled={Boolean(busy) || dirty} onClick={() => void load()}>刷新</Button>}>
      <Table<Run> rowKey="id" dataSource={runs} pagination={{ pageSize: 10 }} scroll={{ x: 760 }} columns={[
        { title: "日期", dataIndex: "report_date" },
        { title: "类型", dataIndex: "kind", render: (v: string) => v === "test" ? "连接测试" : "每日简报" },
        { title: "目标", render: (_, r) => `${r.target_group} · @${r.mention_name}` },
        { title: "状态", dataIndex: "status", render: (v: string) => <Tag color={statuses[v]?.color}>{statuses[v]?.text || v}</Tag> },
        { title: "发送时间（北京）", dataIndex: "sent_at", render: (v: string | null) => v ? localTime(v) : "—" },
        { title: "操作", render: (_, r) => <Button type="link" icon={<EyeOutlined />} onClick={() => setDetail(r)}>查看</Button> },
      ]} />
    </Card>
    <Drawer title="简报详情" open={Boolean(detail)} onClose={() => setDetail(undefined)} size="large">
      {detail && <><Tag color={statuses[detail.status]?.color}>{statuses[detail.status]?.text}</Tag><Typography.Paragraph>{detail.target_group} · @{detail.mention_name}</Typography.Paragraph>{detail.error && <Alert showIcon type="warning" title={detail.error} style={{ marginBottom: 16 }} />}<Typography.Paragraph style={{ whiteSpace: "pre-wrap" }}>{detail.content || "尚未生成正文"}</Typography.Paragraph>{detail.status === "failed" && detail.kind === "daily" && detail.report_date === new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Shanghai"}).format(new Date()) && <Button disabled={!canSend || Boolean(busy)} onClick={() => void send(false, true)}>修复配置后重试今日简报</Button>}</>}
    </Drawer>
  </Space>;
}
