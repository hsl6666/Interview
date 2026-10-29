import { Form, Input, InputNumber, Modal, Select, Switch } from "antd";
import type { OralQuestion } from "../../types";
import PositionSelect from "../../components/PositionSelect";

export type OralQuestionValues = Omit<OralQuestion, "id" | "set_id" | "created_at" | "updated_at">;

type Props = {
  question: OralQuestion | null;
  setName: string;
  nextOrder: number;
  saving: boolean;
  onSave: (values: OralQuestionValues) => Promise<void>;
  onCancel: () => void;
};

export const oralDifficultyOptions = [
  { label: "初级", value: "easy" },
  { label: "中级", value: "medium" },
  { label: "高级", value: "hard" },
];

export default function OralQuestionEditor({
  question,
  setName,
  nextOrder,
  saving,
  onSave,
  onCancel,
}: Props) {
  const [form] = Form.useForm<OralQuestionValues>();
  return (
    <Modal
      open
      title={`${question ? "编辑题目" : "新建题目"} · ${setName}`}
      width={760}
      onCancel={onCancel}
      onOk={() => form.submit()}
      okText="保存题目"
      cancelText="取消"
      confirmLoading={saving}
      cancelButtonProps={{ disabled: saving }}
      closable={!saving}
      maskClosable={!saving}
    >
      <Form
        name="oral-question-editor"
        form={form}
        layout="vertical"
        initialValues={
          question || {
            title: "",
            prompt: "",
            role_tags: "通用",
            difficulty: "medium",
            sort_order: nextOrder,
            published: false,
          }
        }
        onFinish={(values) => void onSave({ ...values, source: question?.source || "manual" })}
      >
        <div className="grid gap-x-4 md:grid-cols-2">
          <Form.Item
            label="题目标题"
            name="title"
            rules={[{ required: true, whitespace: true, message: "请输入题目标题" }]}
          >
            <Input maxLength={200} />
          </Form.Item>
          <Form.Item
            label="套内排序（越小越靠前）"
            name="sort_order"
            rules={[{ required: true, message: "请输入排序值" }]}
          >
            <InputNumber min={0} precision={0} className="w-full" />
          </Form.Item>
        </div>
        <Form.Item
          label="题干"
          name="prompt"
          rules={[{ required: true, whitespace: true, message: "请输入题干" }]}
        >
          <Input.TextArea rows={5} />
        </Form.Item>
        <div className="grid gap-x-4 md:grid-cols-3">
          <Form.Item
            label="岗位标签（用于检索）"
            name="role_tags"
            getValueProps={(value: string) => ({ value: (value || "").split(",").filter(Boolean) })}
            getValueFromEvent={(value: string[]) => (value.length ? value.join(",") : "通用")}
          >
            <PositionSelect mode="multiple" placeholder="可多选" maxTagCount="responsive" />
          </Form.Item>
          <Form.Item label="难度" name="difficulty">
            <Select options={oralDifficultyOptions} />
          </Form.Item>
          <Form.Item label="发布题目" name="published" valuePropName="checked">
            <Switch />
          </Form.Item>
        </div>
        <p className="text-xs text-stone-500">只有已发布的题目会在这套题被用于口试时出题。</p>
      </Form>
    </Modal>
  );
}
