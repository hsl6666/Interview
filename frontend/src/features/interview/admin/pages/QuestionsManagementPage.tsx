import { useEffect, useMemo, useState } from "react";
import { DeleteOutlined, EditOutlined, PlusOutlined, RobotOutlined, SearchOutlined, SyncOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  message,
  type TableColumnsType,
} from "antd";
import dayjs from "dayjs";
import {
  createAdminWrittenQuestion,
  deleteAdminWrittenQuestion,
  fetchAdminWrittenQuestions,
  generateAdminWrittenQuestions,
  updateAdminWrittenQuestion,
} from "../../api";
import OralQuestionSetsManager from "../components/OralQuestionSetsManager";
import PositionSelect from "../../components/PositionSelect";
import { DEFAULT_SYSTEM_PROMPT, questionTypeOptions } from "../constants";
import { GeneratedQuestionModal, GeneratingQuestionModal, QuestionEditorModal } from "../components/QuestionModals";
import { getApiErrorMessage, normalizeQuestionPayload, type QuestionFormValues } from "../utils";
import type { Question, QuestionGenerationRequest, QuestionType, WrittenQuestion } from "../../types";

type QuestionFilters = {
  keyword: string;
  type?: QuestionType;
  role_tags?: string;
  difficulty?: string;
  source?: string;
  published?: boolean;
};

const emptyFilters: QuestionFilters = { keyword: "" };

const difficultyOptions = [
  { label: "初级", value: "easy" },
  { label: "中级", value: "medium" },
  { label: "高级", value: "hard" },
];

const sourceOptions = [
  { label: "手动", value: "manual" },
  { label: "AI 生成", value: "ai" },
  { label: "种子", value: "seed" },
];

const publishedOptions = [
  { label: "已发布", value: true },
  { label: "未发布", value: false },
];

function matchesRoleTags(roleTags: string, position?: string) {
  if (!position) return true;
  const tags = (roleTags || "通用")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return tags.includes(position);
}

function filterQuestions(rows: WrittenQuestion[], filters: QuestionFilters) {
  const keyword = filters.keyword.trim().toLowerCase();
  return rows.filter((row) => {
    if (keyword) {
      const haystack = `${row.title} ${row.prompt}`.toLowerCase();
      if (!haystack.includes(keyword)) return false;
    }
    if (filters.type && row.type !== filters.type) return false;
    if (!matchesRoleTags(row.role_tags, filters.role_tags)) return false;
    if (filters.difficulty && row.difficulty !== filters.difficulty) return false;
    if (filters.source && row.source !== filters.source) return false;
    if (filters.published !== undefined && row.published !== filters.published) return false;
    return true;
  });
}

function WrittenQuestionsManager() {
  const [rows, setRows] = useState<WrittenQuestion[]>([]);
  const [filters, setFilters] = useState<QuestionFilters>(emptyFilters);
  const [draftFilters, setDraftFilters] = useState<QuestionFilters>(emptyFilters);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<WrittenQuestion | null>(null);
  const [generated, setGenerated] = useState<Question[]>([]);
  const [generationModalOpen, setGenerationModalOpen] = useState(false);
  const [selectedGeneratedIds, setSelectedGeneratedIds] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generationForm] = Form.useForm<QuestionGenerationRequest>();
  const [questionForm] = Form.useForm<QuestionFormValues>();

  const filteredRows = useMemo(() => filterQuestions(rows, filters), [rows, filters]);
  const hasActiveFilters = useMemo(
    () =>
      Boolean(
        filters.keyword.trim() ||
          filters.type ||
          filters.role_tags ||
          filters.difficulty ||
          filters.source ||
          filters.published !== undefined,
      ),
    [filters],
  );

  useEffect(() => {
    void loadQuestions();
  }, []);

  async function loadQuestions() {
    setLoading(true);
    try {
      setRows(await fetchAdminWrittenQuestions());
    } catch {
      message.error("加载题库失败，请确认后端服务可用");
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setEditing(null);
    setModalOpen(true);
  }

  function openEdit(row: WrittenQuestion) {
    setEditing(row);
    setModalOpen(true);
  }

  async function saveQuestion() {
    const values = await questionForm.validateFields();
    setSaving(true);
    try {
      if (editing) await updateAdminWrittenQuestion(editing.id, normalizeQuestionPayload(values));
      else await createAdminWrittenQuestion(normalizeQuestionPayload(values));
      setModalOpen(false);
      await loadQuestions();
      message.success("题目已保存");
    } catch {
      message.error("保存题目失败");
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(row: WrittenQuestion) {
    Modal.confirm({
      title: "删除题目",
      content: `确认删除「${row.title}」？删除后不会再出现在前台笔试。`,
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          await deleteAdminWrittenQuestion(row.id);
          await loadQuestions();
          message.success("题目删除成功");
        } catch {
          message.error("题目删除失败");
          throw new Error("delete question failed");
        }
      },
    });
  }

  async function togglePublished(row: WrittenQuestion, published: boolean) {
    try {
      await updateAdminWrittenQuestion(row.id, { published });
      await loadQuestions();
    } catch {
      message.error("发布状态更新失败");
    }
  }

  async function generateQuestions() {
    const values = await generationForm.validateFields();
    setGenerating(true);
    try {
      const response = await generateAdminWrittenQuestions(values);
      setGenerated(response.questions);
      setSelectedGeneratedIds(response.questions.map((item) => item.id));
      setGenerationModalOpen(true);
      if (response.fallback_used) message.warning("当前使用本地兜底规则生成，配置大模型 Key 后可启用真实智能体生成");
    } catch (error) {
      message.error(getApiErrorMessage(error));
    } finally {
      setGenerating(false);
    }
  }

  function buildGeneratedQuestionPayload(question: Question, published: boolean) {
    const generation = generationForm.getFieldsValue();
    return {
      ...question,
      role_tags: generation.role || "通用",
      difficulty: generation.difficulty || "medium",
      source: "ai",
      evaluation_points: "",
      published,
    };
  }

  async function addSelectedGeneratedQuestions(published: boolean) {
    const selected = generated.filter((item) => selectedGeneratedIds.includes(item.id));
    if (!selected.length) {
      message.warning("请至少选择一道候选题");
      return;
    }
    setSaving(true);
    try {
      for (const question of selected) {
        await createAdminWrittenQuestion(buildGeneratedQuestionPayload(question, published));
      }
      await loadQuestions();
      setGenerationModalOpen(false);
      setGenerated([]);
      setSelectedGeneratedIds([]);
      message.success(published ? "已批量加入并发布" : "已批量加入草稿");
    } catch {
      message.error("候选题入库失败");
    } finally {
      setSaving(false);
    }
  }

  function applyFilters() {
    setFilters({ ...draftFilters });
  }

  function resetFilters() {
    setDraftFilters(emptyFilters);
    setFilters(emptyFilters);
  }

  const columns: TableColumnsType<WrittenQuestion> = [
    {
      title: "题目",
      dataIndex: "title",
      fixed: "left",
      width: 260,
      render: (title, row) => (
        <div>
          <div className="font-semibold text-stone-950">{title}</div>
          <div className="mt-1 line-clamp-2 text-xs leading-5 text-stone-500">{row.prompt}</div>
        </div>
      ),
    },
    {
      title: "考察点",
      dataIndex: "evaluation_points",
      width: 240,
      render: (value) => <div className="line-clamp-2 text-xs leading-5 text-stone-500">{value || "-"}</div>,
    },
    { title: "题型", dataIndex: "type", width: 90, render: (type) => <Tag color="blue">{type}</Tag> },
    { title: "岗位标签", dataIndex: "role_tags", width: 140, render: (value) => value || "通用" },
    { title: "难度", dataIndex: "difficulty", width: 100 },
    { title: "来源", dataIndex: "source", width: 90, render: (value) => <Tag>{value}</Tag> },
    {
      title: "发布",
      dataIndex: "published",
      width: 100,
      render: (published, row) => <Switch checked={published} onChange={(checked) => void togglePublished(row, checked)} />,
    },
    {
      title: "更新时间",
      dataIndex: "updated_at",
      width: 160,
      render: (value) => <span className="text-xs text-stone-500">{dayjs(value).format("YYYY-MM-DD HH:mm")}</span>,
    },
    {
      title: "操作",
      fixed: "right",
      width: 150,
      render: (_, row) => (
        <Space>
          <Button icon={<EditOutlined />} onClick={() => openEdit(row)} />
          <Button danger icon={<DeleteOutlined />} onClick={() => confirmDelete(row)} />
        </Space>
      ),
    },
  ];

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
      <section className="rounded-lg border border-stone-200 bg-white p-5">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold">笔试题库</h2>
            <p className="mt-1 text-sm text-stone-500">只有发布状态的题目会进入前台面试人员笔试。</p>
          </div>
          <Space>
            <Button icon={<SyncOutlined />} onClick={() => void loadQuestions()}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新建题目
            </Button>
          </Space>
        </div>

        <Form layout="vertical" className="mb-4 rounded-lg bg-stone-50 p-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <Form.Item label="关键词" className="!mb-0">
              <Input
                allowClear
                placeholder="题目标题或题干"
                value={draftFilters.keyword}
                onChange={(event) => setDraftFilters((prev) => ({ ...prev, keyword: event.target.value }))}
                onPressEnter={applyFilters}
              />
            </Form.Item>
            <Form.Item label="题型" className="!mb-0">
              <Select
                allowClear
                placeholder="全部题型"
                options={questionTypeOptions}
                value={draftFilters.type}
                onChange={(value) => setDraftFilters((prev) => ({ ...prev, type: value }))}
              />
            </Form.Item>
            <Form.Item label="适用岗位" className="!mb-0">
              <PositionSelect
                allowClear
                placeholder="全部岗位"
                value={draftFilters.role_tags}
                onChange={(value) => setDraftFilters((prev) => ({ ...prev, role_tags: value }))}
              />
            </Form.Item>
            <Form.Item label="难度" className="!mb-0">
              <Select
                allowClear
                placeholder="全部难度"
                options={difficultyOptions}
                value={draftFilters.difficulty}
                onChange={(value) => setDraftFilters((prev) => ({ ...prev, difficulty: value }))}
              />
            </Form.Item>
            <Form.Item label="来源" className="!mb-0">
              <Select
                allowClear
                placeholder="全部来源"
                options={sourceOptions}
                value={draftFilters.source}
                onChange={(value) => setDraftFilters((prev) => ({ ...prev, source: value }))}
              />
            </Form.Item>
            <Form.Item label="发布状态" className="!mb-0">
              <Select
                allowClear
                placeholder="全部状态"
                options={publishedOptions}
                value={draftFilters.published}
                onChange={(value) => setDraftFilters((prev) => ({ ...prev, published: value }))}
              />
            </Form.Item>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-stone-500">
              共 {rows.length} 题
              {hasActiveFilters ? `，筛选后 ${filteredRows.length} 题` : null}
            </span>
            <Space>
              <Button onClick={resetFilters}>重置</Button>
              <Button type="primary" icon={<SearchOutlined />} onClick={applyFilters}>
                查询
              </Button>
            </Space>
          </div>
        </Form>

        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={filteredRows}
          scroll={{ x: 1350 }}
          pagination={{ pageSize: 8, showSizeChanger: false }}
          locale={{ emptyText: hasActiveFilters ? "没有符合筛选条件的题目" : "暂无题目" }}
        />
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-5">
        <div className="mb-4 flex items-center gap-2">
          <RobotOutlined className="text-lg text-emerald-800" />
          <h2 className="text-lg font-semibold">题目生成智能体</h2>
        </div>
        <Form
          form={generationForm}
          layout="vertical"
          initialValues={{
            role: undefined,
            count: 5,
            difficulty: "medium",
            question_types: ["single", "multi", "short", "code"],
            system_prompt: DEFAULT_SYSTEM_PROMPT,
            user_prompt: "",
          }}
        >
          <Form.Item label="岗位" name="role" rules={[{ required: true, message: "请选择岗位" }]}>
            <PositionSelect placeholder="请选择目标岗位" />
          </Form.Item>
          <Form.Item label="系统提示词" name="system_prompt">
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item label="用户提示词" name="user_prompt">
            <Input.TextArea rows={4} placeholder="例如：题目偏实战，减少概念题，代码题使用 TypeScript" />
          </Form.Item>
          <div className="grid grid-cols-2 gap-3">
            <Form.Item label="数量" name="count">
              <InputNumber min={1} max={20} className="w-full" />
            </Form.Item>
            <Form.Item label="难度" name="difficulty">
              <Select
                options={[
                  { label: "初级", value: "easy" },
                  { label: "中级", value: "medium" },
                  { label: "高级", value: "hard" },
                ]}
              />
            </Form.Item>
          </div>
          <Form.Item label="题型" name="question_types">
            <Checkbox.Group options={questionTypeOptions} />
          </Form.Item>
          <Button type="primary" block icon={<RobotOutlined />} loading={generating} onClick={() => void generateQuestions()}>
            生成候选题
          </Button>
        </Form>

        <Alert className="mt-5" type="info" showIcon title="生成结果会在弹窗中展示，勾选确认后再加入题库。" />
      </section>

      <QuestionEditorModal
        open={modalOpen}
        editing={editing}
        form={questionForm}
        saving={saving}
        onCancel={() => setModalOpen(false)}
        onSave={() => void saveQuestion()}
      />
      <GeneratedQuestionModal
        open={generationModalOpen}
        questions={generated}
        selectedIds={selectedGeneratedIds}
        saving={saving}
        onSelectedChange={setSelectedGeneratedIds}
        onCancel={() => setGenerationModalOpen(false)}
        onAddDraft={() => void addSelectedGeneratedQuestions(false)}
        onAddPublished={() => void addSelectedGeneratedQuestions(true)}
      />
      <GeneratingQuestionModal open={generating} />
    </div>
  );
}

export default function QuestionsManagementPage() {
  return (
    <Tabs
      defaultActiveKey="written"
      items={[
        { key: "written", label: "笔试题管理", children: <WrittenQuestionsManager /> },
        { key: "oral", label: "口试题管理", children: <OralQuestionSetsManager /> },
      ]}
    />
  );
}
