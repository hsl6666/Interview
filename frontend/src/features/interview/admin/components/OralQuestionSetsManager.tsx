import { useEffect, useState } from "react";
import {
  ArrowLeftOutlined,
  AppstoreAddOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  message,
  type TableColumnsType,
} from "antd";
import dayjs from "dayjs";
import {
  activateAdminOralQuestionSet,
  createAdminOralQuestion,
  createAdminOralQuestionSet,
  deleteAdminOralQuestion,
  deleteAdminOralQuestionSet,
  fetchAdminOralQuestions,
  fetchAdminOralQuestionSets,
  updateAdminOralQuestion,
  updateAdminOralQuestionSet,
} from "../../api";
import type { OralQuestion, OralQuestionSet, OralQuestionSetCreate } from "../../types";
import QuestionPrompt from "../../components/QuestionPrompt";
import { getApiErrorMessage } from "../utils";
import OralQuestionEditor, { oralDifficultyOptions, type OralQuestionValues } from "./OralQuestionEditor";
import OralSetComposer from "./OralSetComposer";

export default function OralQuestionSetsManager() {
  const [sets, setSets] = useState<OralQuestionSet[]>([]);
  const [questions, setQuestions] = useState<OralQuestion[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [setEditor, setSetEditor] = useState<{ paper: OralQuestionSet | null } | null>(null);
  const [questionEditor, setQuestionEditor] = useState<{ question: OralQuestion | null } | null>(null);
  const [composing, setComposing] = useState(false);
  const [keyword, setKeyword] = useState("");
  const selected = sets.find((paper) => paper.id === selectedId);
  const active = sets.find((paper) => paper.is_active);
  const rows = questions.filter((question) => question.set_id === selectedId);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [nextSets, nextQuestions] = await Promise.all([
        fetchAdminOralQuestionSets(),
        fetchAdminOralQuestions(),
      ]);
      setSets(nextSets);
      setQuestions(nextQuestions);
      setError("");
    } catch (cause) {
      setError(`加载套题失败：${getApiErrorMessage(cause)}`);
    } finally {
      setLoading(false);
    }
  }

  async function mutate(action: () => Promise<unknown>, success: string) {
    setSaving(true);
    try {
      await action();
      await load();
      message.success(success);
    } catch (cause) {
      message.error(getApiErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  async function saveSet(values: OralQuestionSetCreate) {
    await mutate(async () => {
      if (setEditor?.paper) {
        await updateAdminOralQuestionSet(setEditor.paper.id, values);
      } else {
        const created = await createAdminOralQuestionSet(values);
        setSelectedId(created.id);
      }
      setSetEditor(null);
      setComposing(false);
    }, "套题已保存");
  }

  async function saveQuestion(values: OralQuestionValues) {
    if (!selected) return;
    await mutate(async () => {
      if (questionEditor?.question) await updateAdminOralQuestion(questionEditor.question.id, values);
      else await createAdminOralQuestion({ ...values, set_id: selected.id });
      setQuestionEditor(null);
    }, "题目已保存");
  }

  function confirmDeleteSet(paper: OralQuestionSet) {
    Modal.confirm({
      title: `删除「${paper.name}」？`,
      content: `将删除此套题及其中 ${paper.question_count} 道题，其他套题的独立副本和已开始的口试记录会保留。`,
      okText: "删除套题",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteAdminOralQuestionSet(paper.id);
          if (selectedId === paper.id) setSelectedId(null);
          await load();
          message.success("套题已删除");
        } catch (cause) {
          message.error(getApiErrorMessage(cause));
          throw cause;
        }
      },
    });
  }

  function confirmDeleteQuestion(question: OralQuestion) {
    Modal.confirm({
      title: `删除「${question.title}」？`,
      content: "仅删除当前套题中的这道题。其他套题及已开始的口试记录会保留。",
      okText: "删除题目",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteAdminOralQuestion(question.id);
          await load();
          message.success("题目已删除");
        } catch (cause) {
          message.error(getApiErrorMessage(cause));
          throw cause;
        }
      },
    });
  }

  const setColumns: TableColumnsType<OralQuestionSet> = [
    {
      title: "套题",
      dataIndex: "name",
      width: 300,
      render: (name, paper) => (
        <div>
          <Button type="link" className="!h-auto !p-0 !font-semibold" onClick={() => setSelectedId(paper.id)}>
            {name}
          </Button>
          {paper.is_active ? (
            <Tag color="green" className="!ml-2">
              当前使用
            </Tag>
          ) : null}
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-stone-500">
            {paper.description || "暂无说明"}
          </p>
        </div>
      ),
    },
    {
      title: "题目数量",
      width: 150,
      render: (_, paper) => `${paper.question_count} 题 / 已发布 ${paper.published_question_count} 题`,
    },
    {
      title: "发布套题",
      width: 100,
      render: (_, paper) => (
        <Switch
          checked={paper.published}
          disabled={saving || paper.is_active || (!paper.published && !paper.published_question_count)}
          aria-label={`发布套题：${paper.name}`}
          onChange={(published) =>
            void mutate(
              () => updateAdminOralQuestionSet(paper.id, { published }),
              published ? "套题已发布，可选择用于口试" : "套题已转为草稿",
            )
          }
        />
      ),
    },
    {
      title: "更新时间",
      dataIndex: "updated_at",
      width: 150,
      render: (value) => dayjs(value).format("YYYY-MM-DD HH:mm"),
    },
    {
      title: "操作",
      width: 260,
      render: (_, paper) => (
        <Space wrap>
          <Button size="small" onClick={() => setSelectedId(paper.id)}>
            管理题目
          </Button>
          <Button
            size="small"
            disabled={saving || !paper.published || !paper.published_question_count || paper.is_active}
            onClick={() =>
              void mutate(() => activateAdminOralQuestionSet(paper.id), `口试已切换为「${paper.name}」`)
            }
          >
            用于口试
          </Button>
          <Button
            size="small"
            aria-label={`编辑套题：${paper.name}`}
            icon={<EditOutlined />}
            disabled={saving}
            onClick={() => setSetEditor({ paper })}
          />
          <Button
            size="small"
            danger
            aria-label={`删除套题：${paper.name}`}
            icon={<DeleteOutlined />}
            disabled={saving || paper.is_active}
            onClick={() => confirmDeleteSet(paper)}
          />
        </Space>
      ),
    },
  ];

  const questionColumns: TableColumnsType<OralQuestion> = [
    { title: "排序", dataIndex: "sort_order", width: 75 },
    {
      title: "题目",
      dataIndex: "title",
      width: 350,
      render: (title, question) => (
        <div>
          <p className="font-semibold">{title}</p>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-stone-500">{question.prompt}</p>
        </div>
      ),
    },
    { title: "岗位标签", dataIndex: "role_tags", width: 140, render: (value) => value || "通用" },
    {
      title: "难度",
      dataIndex: "difficulty",
      width: 80,
      render: (value) => oralDifficultyOptions.find((option) => option.value === value)?.label || value,
    },
    {
      title: "发布题目",
      width: 100,
      render: (_, question) => (
        <Switch
          aria-label={`发布题目：${question.title}`}
          checked={question.published}
          disabled={saving}
          onChange={(published) =>
            void mutate(() => updateAdminOralQuestion(question.id, { published }), "题目状态已更新")
          }
        />
      ),
    },
    {
      title: "操作",
      width: 130,
      render: (_, question) => (
        <Space>
          <Button
            aria-label={`编辑题目：${question.title}`}
            icon={<EditOutlined />}
            disabled={saving}
            onClick={() => setQuestionEditor({ question })}
          />
          <Button
            danger
            aria-label={`删除题目：${question.title}`}
            icon={<DeleteOutlined />}
            disabled={saving}
            onClick={() => confirmDeleteQuestion(question)}
          />
        </Space>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {error ? (
        <Alert
          type="error"
          showIcon
          title={error}
          action={<Button onClick={() => void load()}>重试</Button>}
        />
      ) : null}
      <section className="flex flex-col gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="font-semibold text-emerald-950">当前口试使用套题</h2>
          <p className="mt-1 text-xs leading-5 text-emerald-800">
            新开始的口试按所选套题出题，已开始的口试保留原题目。
          </p>
        </div>
        <Select
          aria-label="当前口试使用套题"
          className="w-full md:!w-72"
          placeholder="请选择已发布套题"
          value={active?.id}
          loading={loading || saving}
          disabled={loading || saving || Boolean(error)}
          options={sets.map((paper) => ({
            value: paper.id,
            label: `${paper.name}（${paper.published_question_count} 题）${paper.published ? "" : " · 草稿"}`,
            disabled: !paper.published || !paper.published_question_count,
          }))}
          onChange={(id) => void mutate(() => activateAdminOralQuestionSet(id), "当前口试套题已切换")}
        />
      </section>
      <section className="rounded-lg border border-stone-200 bg-white p-5">
        {selected ? (
          <>
            <Button
              type="text"
              icon={<ArrowLeftOutlined />}
              className="!mb-4 !pl-0"
              onClick={() => setSelectedId(null)}
            >
              返回套题列表
            </Button>
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="text-lg font-semibold">
                  {selected.name}{" "}
                  <Tag color={selected.published ? "green" : "default"}>
                    {selected.published ? "已发布" : "草稿"}
                  </Tag>
                </h2>
                <p className="mt-1 text-sm text-stone-500">
                  共 {rows.length} 题 · {selected.published_question_count} 题已发布。按排序值从小到大出题。
                </p>
                {selected.description ? (
                  <p className="mt-2 text-sm text-stone-600">{selected.description}</p>
                ) : null}
              </div>
              <Space wrap>
                <Button onClick={() => setSetEditor({ paper: selected })} disabled={saving}>
                  编辑套题
                </Button>
                <Button
                  disabled={saving || !selected.published_question_count || selected.is_active}
                  onClick={() =>
                    void mutate(
                      () =>
                        selected.published
                          ? activateAdminOralQuestionSet(selected.id)
                          : updateAdminOralQuestionSet(selected.id, { published: true }),
                      selected.published ? "已用于后续口试" : "套题已发布，请点击用于口试",
                    )
                  }
                >
                  {selected.is_active ? "当前使用中" : selected.published ? "用于口试" : "发布套题"}
                </Button>
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  disabled={saving || loading}
                  onClick={() => setQuestionEditor({ question: null })}
                >
                  新建题目
                </Button>
              </Space>
            </div>
            {!rows.length ? (
              <Alert
                className="!mb-4"
                type="info"
                showIcon
                title="套题已建好，请先添加题目；发布题目后即可发布整套并用于口试。"
              />
            ) : null}
            <Table
              rowKey="id"
              dataSource={rows}
              columns={questionColumns}
              loading={loading}
              scroll={{ x: 875 }}
              pagination={{ pageSize: 8, showSizeChanger: false }}
              locale={{ emptyText: "此套题还没有题目，点击“新建题目”开始添加" }}
              expandable={{
                expandedRowRender: (row) => (
                  <div className="text-sm leading-6"><QuestionPrompt content={row.prompt} /></div>
                ),
              }}
            />
          </>
        ) : (
          <>
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="text-lg font-semibold">口试套题</h2>
                <p className="mt-1 text-sm text-stone-500">
                  先新建一套题，再进入套内管理题目；也可以从多套题中挑选组合。
                </p>
              </div>
              <Space wrap>
                <Button icon={<SyncOutlined />} onClick={() => void load()} disabled={loading || saving}>
                  刷新
                </Button>
                <Button
                  icon={<AppstoreAddOutlined />}
                  onClick={() => setComposing(true)}
                  disabled={loading || saving || !questions.length}
                >
                  自定义组套
                </Button>
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => setSetEditor({ paper: null })}
                  disabled={loading || saving}
                >
                  新建套题
                </Button>
              </Space>
            </div>
            <Input
              aria-label="搜索套题"
              placeholder="搜索套题名称或说明"
              className="!mb-4 !max-w-sm"
              allowClear
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
            <Table
              rowKey="id"
              columns={setColumns}
              loading={loading}
              scroll={{ x: 1060 }}
              dataSource={sets.filter((paper) =>
                `${paper.name} ${paper.description}`.toLowerCase().includes(keyword.trim().toLowerCase()),
              )}
              pagination={{ pageSize: 8, showSizeChanger: false }}
              locale={{ emptyText: "暂无套题，请新建一套题" }}
            />
          </>
        )}
      </section>
      {setEditor ? (
        <SetEditor
          paper={setEditor.paper}
          saving={saving}
          onCancel={() => setSetEditor(null)}
          onSave={saveSet}
        />
      ) : null}
      {questionEditor && selected ? (
        <OralQuestionEditor
          question={questionEditor.question}
          setName={selected.name}
          nextOrder={rows.length ? Math.max(...rows.map((q) => q.sort_order)) + 1 : 0}
          saving={saving}
          onCancel={() => setQuestionEditor(null)}
          onSave={saveQuestion}
        />
      ) : null}
      {composing ? (
        <OralSetComposer
          sets={sets}
          questions={questions}
          saving={saving}
          onCancel={() => setComposing(false)}
          onSave={saveSet}
        />
      ) : null}
    </div>
  );
}

function SetEditor({
  paper,
  saving,
  onCancel,
  onSave,
}: {
  paper: OralQuestionSet | null;
  saving: boolean;
  onCancel: () => void;
  onSave: (values: OralQuestionSetCreate) => Promise<void>;
}) {
  const [form] = Form.useForm<OralQuestionSetCreate>();
  return (
    <Modal
      open
      title={paper ? "编辑套题" : "新建套题"}
      onCancel={onCancel}
      onOk={() => form.submit()}
      okText={paper ? "保存" : "创建并管理题目"}
      cancelText="取消"
      confirmLoading={saving}
      cancelButtonProps={{ disabled: saving }}
      closable={!saving}
      maskClosable={!saving}
    >
      <Form
        name="oral-set-editor"
        form={form}
        layout="vertical"
        initialValues={paper || { name: "", description: "" }}
        onFinish={(values) => void onSave(values)}
      >
        <Form.Item
          label="套题名称"
          name="name"
          rules={[{ required: true, whitespace: true, message: "请输入套题名称" }]}
        >
          <Input placeholder="例如：A 套、产品经理基础套题" maxLength={200} />
        </Form.Item>
        <Form.Item label="套题说明" name="description">
          <Input.TextArea rows={3} placeholder="填写用途或考察重点（可选）" />
        </Form.Item>
        {!paper ? <p className="text-sm text-stone-500">创建后进入套内添加题目，新套题默认为草稿。</p> : null}
      </Form>
    </Modal>
  );
}
