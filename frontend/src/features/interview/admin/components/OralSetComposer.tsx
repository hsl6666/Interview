import { useMemo, useState } from "react";
import { ArrowDownOutlined, ArrowUpOutlined, CloseOutlined, SearchOutlined } from "@ant-design/icons";
import { Alert, Button, Empty, Form, Input, Modal, Select, Space, Table, Tag } from "antd";
import type { OralQuestion, OralQuestionSet, OralQuestionSetCreate } from "../../types";

type Props = {
  sets: OralQuestionSet[];
  questions: OralQuestion[];
  saving: boolean;
  onCancel: () => void;
  onSave: (payload: OralQuestionSetCreate) => Promise<void>;
};

export default function OralSetComposer({ sets, questions, saving, onCancel, onSave }: Props) {
  const [form] = Form.useForm<OralQuestionSetCreate>();
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [keyword, setKeyword] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const questionById = useMemo(() => new Map(questions.map((q) => [q.id, q])), [questions]);
  const setById = useMemo(() => new Map(sets.map((s) => [s.id, s.name])), [sets]);
  const available = questions.filter(
    (q) =>
      (!sourceIds.length || sourceIds.includes(q.set_id)) &&
      `${q.title} ${q.prompt} ${q.role_tags}`.toLowerCase().includes(keyword.trim().toLowerCase()),
  );

  function move(index: number, offset: number) {
    setSelectedIds((previous) => {
      const next = [...previous];
      [next[index], next[index + offset]] = [next[index + offset], next[index]];
      return next;
    });
  }

  return (
    <Modal
      title="自定义组套"
      open
      width={1080}
      onCancel={onCancel}
      onOk={() => form.submit()}
      okText={`创建套题（${selectedIds.length} 题）`}
      cancelText="取消"
      confirmLoading={saving}
      okButtonProps={{ disabled: !selectedIds.length || saving }}
      cancelButtonProps={{ disabled: saving }}
      closable={!saving}
      maskClosable={!saving}
    >
      <Form
        name="oral-set-composer"
        form={form}
        layout="vertical"
        onFinish={(values) => void onSave({ ...values, question_ids: selectedIds })}
      >
        <div className="grid gap-x-4 md:grid-cols-2">
          <Form.Item
            label="新套题名称"
            name="name"
            rules={[{ required: true, whitespace: true, message: "请输入套题名称" }]}
          >
            <Input placeholder="例如：综合面试 C 套" maxLength={200} />
          </Form.Item>
          <Form.Item label="套题说明" name="description" initialValue="">
            <Input placeholder="说明这套题的用途或考察重点" />
          </Form.Item>
        </div>
        <Alert
          type="info"
          showIcon
          title="跨套勾选题目，按右侧顺序组合；新套题保存为独立副本，编辑互不影响。"
          className="!mb-4"
        />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <section className="min-w-0">
            <div className="mb-3 grid gap-3 md:grid-cols-2">
              <Select
                aria-label="来源套题"
                mode="multiple"
                placeholder="全部来源套题"
                allowClear
                maxTagCount="responsive"
                value={sourceIds}
                onChange={setSourceIds}
                options={sets.map((s) => ({ value: s.id, label: s.name }))}
              />
              <Input
                aria-label="搜索来源题目"
                prefix={<SearchOutlined />}
                placeholder="搜索题目或岗位标签"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                allowClear
              />
            </div>
            <Table<OralQuestion>
              rowKey="id"
              size="small"
              dataSource={available}
              scroll={{ x: 460 }}
              pagination={{ pageSize: 6, showSizeChanger: false, showTotal: (total) => `共 ${total} 题` }}
              rowSelection={{
                selectedRowKeys: selectedIds,
                preserveSelectedRowKeys: true,
                onChange: (keys) =>
                  setSelectedIds((previous) => {
                    const next = keys.map(String);
                    return [
                      ...previous.filter((id) => next.includes(id)),
                      ...next.filter((id) => !previous.includes(id)),
                    ];
                  }),
                getCheckboxProps: (row) => ({ "aria-label": `选择题目：${row.title}`, disabled: saving }),
              }}
              columns={[
                {
                  title: "题目",
                  dataIndex: "title",
                  render: (title, row) => (
                    <div>
                      <span className="font-medium">{title}</span>
                      <p className="mt-1 line-clamp-2 text-xs text-stone-500">{row.prompt}</p>
                    </div>
                  ),
                },
                { title: "来源套题", width: 130, render: (_, row) => setById.get(row.set_id) || "—" },
                {
                  title: "状态",
                  width: 80,
                  render: (_, row) => (
                    <Tag color={row.published ? "green" : "default"}>{row.published ? "已发布" : "草稿"}</Tag>
                  ),
                },
              ]}
              expandable={{
                expandedRowRender: (row) => (
                  <p className="whitespace-pre-wrap text-sm leading-6">{row.prompt}</p>
                ),
                rowExpandable: (row) => Boolean(row.prompt),
              }}
              locale={{ emptyText: "没有符合条件的题目" }}
            />
          </section>
          <aside className="rounded-lg border border-stone-200 bg-stone-50 p-4">
            <h3 className="font-semibold">已选 {selectedIds.length} 题</h3>
            <p className="mb-3 mt-1 text-xs text-stone-500">
              此处顺序即新套题顺序；筛选来源不会清空已选题目。
            </p>
            {!selectedIds.length ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="从左侧勾选题目" />
            ) : (
              <ol className="max-h-[420px] space-y-2 overflow-y-auto">
                {selectedIds.map((id, index) => {
                  const question = questionById.get(id);
                  return (
                    <li key={id} className="rounded-md border border-stone-200 bg-white p-3">
                      <p className="text-sm font-medium">
                        {index + 1}. {question?.title || "题目已不可用"}
                      </p>
                      <p className="mt-1 text-xs text-stone-500">{setById.get(question?.set_id || "")}</p>
                      <Space className="mt-2">
                        <Button
                          size="small"
                          aria-label={`上移第 ${index + 1} 题`}
                          icon={<ArrowUpOutlined />}
                          disabled={!index || saving}
                          onClick={() => move(index, -1)}
                        />
                        <Button
                          size="small"
                          aria-label={`下移第 ${index + 1} 题`}
                          icon={<ArrowDownOutlined />}
                          disabled={index === selectedIds.length - 1 || saving}
                          onClick={() => move(index, 1)}
                        />
                        <Button
                          size="small"
                          aria-label={`移除第 ${index + 1} 题`}
                          icon={<CloseOutlined />}
                          disabled={saving}
                          onClick={() => setSelectedIds((ids) => ids.filter((value) => value !== id))}
                        />
                      </Space>
                    </li>
                  );
                })}
              </ol>
            )}
          </aside>
        </div>
      </Form>
    </Modal>
  );
}
