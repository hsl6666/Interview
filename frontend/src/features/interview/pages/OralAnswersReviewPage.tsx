import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button, Empty, Spin, Tag, Typography, message } from "antd";
import { AudioOutlined, PrinterOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { fetchSession, resolveAssetUrl } from "../api";
import { InterviewShell } from "../components/InterviewShell";
import QuestionPrompt from "../components/QuestionPrompt";
import type { InterviewSession, OralRecording, Transcript } from "../types";

type OralAnswerItem = {
  key: string;
  question: string;
  answer: string;
  audioUrl: string;
  durationSeconds: number;
  at: string;
};

export default function OralAnswersReviewPage() {
  const [searchParams] = useSearchParams();
  const sessionId = useMemo(() => searchParams.get("sessionId")?.trim() || "", [searchParams]);
  const [session, setSession] = useState<InterviewSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId) {
      setLoading(false);
      message.error("缺少候选人 sessionId，无法加载口试作答");
      return;
    }

    let ignore = false;
    setLoading(true);
    fetchSession(sessionId)
      .then((nextSession) => {
        if (!ignore) setSession(nextSession);
      })
      .catch(() => {
        if (ignore) return;
        setSession(null);
        message.error("加载口试作答失败，请确认后端服务可用");
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [sessionId]);

  const items = useMemo(() => buildOralAnswerItems(session), [session]);
  const totalDuration = items.reduce((sum, item) => sum + item.durationSeconds, 0);

  return (
    <InterviewShell current="done" title="口试作答查看" description="查看候选人已提交的口试题目、录音和回答记录。">
      {loading ? (
        <div className="flex h-80 items-center justify-center rounded-xl border border-stone-200 bg-white">
          <Spin tip="加载口试作答中..." />
        </div>
      ) : session ? (
        <div className="space-y-5">
          <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <Typography.Title level={3} className="!mb-1">
                  {String(session.candidate_profile.name || "未填写")}
                </Typography.Title>
                <p className="text-sm text-stone-500">{session.role || String(session.candidate_profile.role || "未填写")}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Tag color={items.length ? "green" : "default"}>{items.length} 题已留存</Tag>
                {totalDuration ? <Tag>{formatDuration(totalDuration)}</Tag> : null}
                <Button icon={<PrinterOutlined />} onClick={() => window.print()}>
                  打印
                </Button>
              </div>
            </div>
          </section>

          {items.length ? (
            <section className="space-y-4">
              {items.map((item, index) => (
                <section key={item.key} className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    <Tag>{index + 1}</Tag>
                    <Tag color={item.audioUrl ? "green" : "blue"}>{item.audioUrl ? "录音" : "文字记录"}</Tag>
                    {item.durationSeconds ? <Tag>{formatDuration(item.durationSeconds)}</Tag> : null}
                    {item.at ? <Tag>{dayjs(item.at).format("YYYY-MM-DD HH:mm")}</Tag> : null}
                  </div>

                  <div className="rounded-lg bg-stone-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">Question</div>
                    <div className="mt-2 text-base leading-7 text-stone-950"><QuestionPrompt content={item.question || "未记录题目"} /></div>
                  </div>

                  <div className="mt-4 rounded-lg border border-stone-200 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">Answer</div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-stone-700">{item.answer || "已上传录音文件"}</p>
                    {item.audioUrl ? (
                      <div className="mt-4 border-l-2 border-emerald-800 pl-3">
                        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-stone-700">
                          <AudioOutlined />
                          <span>原始录音</span>
                        </div>
                        <audio controls src={resolveAssetUrl(item.audioUrl)} className="w-full" />
                      </div>
                    ) : null}
                  </div>
                </section>
              ))}
            </section>
          ) : (
            <Empty description="暂无口试作答内容" />
          )}
        </div>
      ) : (
        <Empty description="暂无口试作答内容" />
      )}
    </InterviewShell>
  );
}

function buildOralAnswerItems(session: InterviewSession | null): OralAnswerItem[] {
  if (!session) return [];

  const summaryQa = getSummaryQa(session.oral_summary);
  if (summaryQa.length) return summaryQa;

  if (session.oral_recordings.length) {
    return [...session.oral_recordings]
      .sort((a, b) => a.question_index - b.question_index || new Date(a.created_at).valueOf() - new Date(b.created_at).valueOf())
      .map(recordingToAnswerItem);
  }

  return transcriptsToAnswerItems(session.transcripts);
}

function getSummaryQa(summary: Record<string, unknown>): OralAnswerItem[] {
  const qa = summary.qa;
  if (!Array.isArray(qa)) return [];

  return qa.reduce<OralAnswerItem[]>((items, value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return items;
    const row = value as Record<string, unknown>;
    items.push({
      key: `summary-${index}`,
      question: getString(row.question),
      answer: getString(row.answer || row.filename) || "已上传录音文件",
      audioUrl: getString(row.audio_url),
      durationSeconds: getNumber(row.duration_seconds),
      at: getString(row.at),
    });
    return items;
  }, []);
}

function recordingToAnswerItem(recording: OralRecording): OralAnswerItem {
  return {
    key: recording.id,
    question: recording.question_text,
    answer: recording.filename,
    audioUrl: recording.url,
    durationSeconds: recording.duration_seconds,
    at: recording.created_at,
  };
}

function transcriptsToAnswerItems(transcripts: Transcript[]) {
  const items: OralAnswerItem[] = [];
  let pendingQuestion = "";

  transcripts.forEach((item) => {
    if (item.speaker === "assistant") {
      pendingQuestion = item.text;
      return;
    }

    if (item.speaker === "user" && item.text.trim()) {
      items.push({
        key: `transcript-${item.id}`,
        question: pendingQuestion,
        answer: item.text,
        audioUrl: "",
        durationSeconds: 0,
        at: item.created_at,
      });
      pendingQuestion = "";
    }
  });

  return items;
}

function getString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function getNumber(value: unknown) {
  return typeof value === "number" ? value : 0;
}

function formatDuration(value: number) {
  const minutes = Math.floor(value / 60)
    .toString()
    .padStart(2, "0");
  const seconds = Math.floor(value % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}`;
}
