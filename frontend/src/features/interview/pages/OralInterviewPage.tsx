import { useEffect, useMemo, useRef, useState } from "react";
import { isAxiosError } from "axios";
import { useBlocker, useNavigate } from "react-router-dom";
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  AudioOutlined,
  CheckCircleOutlined,
  DownOutlined,
  StopOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { Alert, Button, Modal, Progress, Skeleton, Tag, message } from "antd";
import {
  createOrUpdateSession,
  fetchInterviewConfig,
  fetchSessionOralQuestionSet,
  fetchSession,
  resolveAssetUrl,
  saveOralSummary,
  uploadOralRecording,
} from "../api";
import { InterviewShell } from "../components/InterviewShell";
import QuestionPrompt from "../components/QuestionPrompt";
import { createOralRecorder, type CapturedAnswer, type RecordingPhase } from "../recording/oralRecorder";
import { getInterviewSessionId, loadProfile } from "../storage";
import type { InterviewFlowConfig, InterviewSession, OralRecording } from "../types";

type RecordedAnswer = {
  questionIndex: number;
  questionText: string;
  filename: string;
  durationSeconds: number;
  recordedAt: string;
  localUrl?: string;
  uploadedUrl?: string;
  blob?: Blob;
};

export default function OralInterviewPage() {
  const navigate = useNavigate();
  const [modal, modalContext] = Modal.useModal();
  const sessionId = useMemo(() => getInterviewSessionId(), []);
  const [flowConfig, setFlowConfig] = useState<InterviewFlowConfig | null>(null);
  const [questions, setQuestions] = useState<string[]>([]);
  const [setName, setSetName] = useState("");
  const [loadError, setLoadError] = useState("");
  const [recordingError, setRecordingError] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [recordings, setRecordings] = useState<Record<number, RecordedAnswer>>({});
  const [phase, setPhase] = useState<RecordingPhase>("idle");
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);
  const [uploadErrors, setUploadErrors] = useState<Record<number, string>>({});
  const [elapsed, setElapsed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const mountedRef = useRef(false);
  const loadIdRef = useRef(0);
  const recorderRef = useRef<ReturnType<typeof createOralRecorder> | null>(null);
  const uploadBusyRef = useRef(false);
  const submitBusyRef = useRef(false);
  const submittedRef = useRef(false);
  const confirmingRef = useRef(false);
  const localUrlsRef = useRef(new Set<string>());
  const audioRef = useRef<HTMLAudioElement>(null);
  const questionRef = useRef<HTMLDivElement>(null);

  const completedCount = questions.filter(
    (q, i) => recordings[i]?.uploadedUrl && recordings[i]?.questionText === q,
  ).length;
  const activeQuestion = questions[currentIndex];
  const activeAnswer = recordings[currentIndex];
  const busy = phase !== "idle" || uploadingIndex !== null || submitting;
  const canFinish =
    !loading && !loadError && questions.length > 0 && completedCount === questions.length && !busy;
  const hasPendingAnswer = Object.values(recordings).some((answer) => answer.blob && !answer.uploadedUrl);
  const needsLeaveWarning = !submittedRef.current && (busy || hasPendingAnswer);
  const blocker = useBlocker(() => !submittedRef.current && (busy || hasPendingAnswer));
  const recordingSupportIssue = getRecordingSupportIssue();
  const totalDuration = Object.values(recordings).reduce(
    (sum, answer) => sum + (answer.uploadedUrl ? answer.durationSeconds : 0),
    0,
  );

  useEffect(() => {
    mountedRef.current = true;
    recorderRef.current = createOralRecorder({
      getStream: () => navigator.mediaDevices.getUserMedia({ audio: true }),
      makeRecorder: (stream) => {
        const mimeType = getSupportedMimeType();
        return new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      },
      onState: (next) => {
        setPhase(next);
        if (next === "recording") setElapsed(0);
      },
      onCapture: (answer) => {
        void captureAnswer(answer);
      },
      onError: (error) => setRecordingError(recordingErrorMessage(error)),
    });
    void ensureSession();
    return () => {
      mountedRef.current = false;
      loadIdRef.current++;
      recorderRef.current?.dispose();
      localUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      localUrlsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (phase !== "recording") return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 250);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (!needsLeaveWarning) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [needsLeaveWarning]);

  useEffect(() => {
    if (blocker.state !== "blocked") return;
    const dialog = modal.confirm({
      title: "录音还没有保存完成，确定离开吗？",
      content: "离开会停止当前录音，尚未上传的录音可能丢失。已保存的答案会保留。",
      okText: "离开页面",
      cancelText: "继续作答",
      okButtonProps: { danger: true },
      onOk: () => blocker.proceed(),
      onCancel: () => blocker.reset(),
    });
    return () => dialog.destroy();
  }, [blocker.state]);

  async function ensureSession() {
    const loadId = ++loadIdRef.current;
    const isCurrent = () => mountedRef.current && loadIdRef.current === loadId;
    setLoading(true);
    setLoadError("");
    try {
      const nextConfig = await fetchInterviewConfig();
      if (!isCurrent()) return;
      setFlowConfig(nextConfig);
      if (!nextConfig.oral_enabled) {
        navigate("/interview/done", { replace: true });
        return;
      }
      let session: InterviewSession;
      try {
        session = await fetchSession(sessionId);
      } catch (error) {
        if (!isAxiosError(error) || error.response?.status !== 404) throw error;
        session = await createOrUpdateSession(sessionId, loadProfile(sessionId));
      }
      const paper = await fetchSessionOralQuestionSet(sessionId);
      if (!isCurrent()) return;
      const nextQuestions = paper.questions.map((item) => item.prompt);
      if (!nextQuestions.length) throw new Error("暂无可用口试套题，请联系管理员");
      setQuestions(nextQuestions);
      setSetName(paper.set_name);
      const restored: Record<number, RecordedAnswer> = {};
      session.oral_recordings.forEach((item) => {
        if (nextQuestions[item.question_index] !== item.question_text) return;
        const previous = restored[item.question_index];
        if (!previous || new Date(item.created_at).valueOf() >= new Date(previous.recordedAt).valueOf())
          restored[item.question_index] = recordingToAnswer(item);
      });
      setRecordings(restored);
      const firstUnfinished = nextQuestions.findIndex((_, i) => !restored[i]?.uploadedUrl);
      setCurrentIndex(firstUnfinished < 0 ? nextQuestions.length - 1 : firstUnfinished);
    } catch (error) {
      if (!isCurrent()) return;
      const detail = isAxiosError(error) ? error.response?.data?.detail : null;
      setLoadError(
        typeof detail === "string"
          ? detail
          : error instanceof Error
            ? error.message
            : "加载口试套题失败，请稍后重试",
      );
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }

  async function startRecording() {
    if (
      confirmingRef.current ||
      loading ||
      loadError ||
      !activeQuestion ||
      uploadBusyRef.current ||
      submitBusyRef.current ||
      recorderRef.current?.state !== "idle"
    )
      return;
    if (recordingSupportIssue) {
      setRecordingError(getRecordingSupportMessage(recordingSupportIssue));
      return;
    }
    if (activeAnswer) {
      confirmingRef.current = true;
      const confirmed = await modal.confirm({
        title: "重新录制这道题？",
        content: activeAnswer.uploadedUrl
          ? "新录音保存成功后将作为本题答案。开始录制不会删除已保存的原录音。"
          : "重新录制将替换当前尚未保存的录音，也可以先重试保存。",
        okText: "开始重录",
        cancelText: "保留当前录音",
      });
      confirmingRef.current = false;
      if (!confirmed || !mountedRef.current) return;
    }
    audioRef.current?.pause();
    setRecordingError("");
    await recorderRef.current?.start({ questionIndex: currentIndex, questionText: activeQuestion });
  }

  async function captureAnswer(capture: CapturedAnswer) {
    const localUrl = URL.createObjectURL(capture.blob);
    localUrlsRef.current.add(localUrl);
    const answer: RecordedAnswer = {
      ...capture,
      localUrl,
      filename: `oral-question-${capture.questionIndex + 1}-${Date.now()}.${getAudioExtension(capture.blob.type)}`,
      recordedAt: new Date().toISOString(),
    };
    setRecordings((items) => ({ ...items, [answer.questionIndex]: answer }));
    await persistRecording(answer);
  }

  async function persistRecording(answer: RecordedAnswer) {
    if (!answer.blob || uploadBusyRef.current) return;
    uploadBusyRef.current = true;
    setUploadingIndex(answer.questionIndex);
    setUploadErrors((items) => ({ ...items, [answer.questionIndex]: "" }));
    try {
      const nextSession = await uploadOralRecording({
        sessionId,
        questionIndex: answer.questionIndex,
        questionText: answer.questionText,
        durationSeconds: answer.durationSeconds,
        blob: answer.blob,
        filename: answer.filename,
      });
      if (!mountedRef.current) return;
      const uploaded = getLatestRecording(
        nextSession.oral_recordings,
        answer.questionIndex,
        answer.questionText,
      );
      if (!uploaded?.url) throw new Error("服务器尚未确认保存");
      setRecordings((items) => ({
        ...items,
        [answer.questionIndex]: { ...recordingToAnswer(uploaded), localUrl: answer.localUrl },
      }));
      message.success(`第 ${answer.questionIndex + 1} 题已保存，可试听或继续下一题`);
    } catch {
      if (mountedRef.current)
        setUploadErrors((items) => ({
          ...items,
          [answer.questionIndex]: "保存失败，录音仍保留在当前页面。请重试保存，暂时不要刷新或关闭页面。",
        }));
    } finally {
      uploadBusyRef.current = false;
      if (mountedRef.current) setUploadingIndex(null);
    }
  }

  function selectQuestion(index: number) {
    if (
      busy ||
      uploadBusyRef.current ||
      recorderRef.current?.state !== "idle" ||
      index < 0 ||
      index >= questions.length
    )
      return;
    audioRef.current?.pause();
    setCurrentIndex(index);
    setRecordingError("");
    setDirectoryOpen(false);
    requestAnimationFrame(() => {
      questionRef.current?.focus({ preventScroll: true });
      questionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function finishInterview() {
    if (!canFinish || submitBusyRef.current || confirmingRef.current) return;
    confirmingRef.current = true;
    const confirmed = await modal.confirm({
      title: "确认提交口试？",
      content: `共 ${questions.length} 道题，录音均已保存，总时长 ${formatDuration(totalDuration)}。你可以返回试听或重录后再提交。`,
      okText: "确认提交",
      cancelText: "返回检查",
    });
    confirmingRef.current = false;
    if (!confirmed || !mountedRef.current || submitBusyRef.current) return;
    submitBusyRef.current = true;
    setSubmitting(true);
    const qa = questions.map((question, i) => ({
      question,
      answer: recordings[i].filename,
      audio_url: recordings[i].uploadedUrl || "",
      duration_seconds: recordings[i].durationSeconds,
      at: recordings[i].recordedAt,
    }));
    try {
      await saveOralSummary(sessionId, qa);
      if (!mountedRef.current) return;
      submittedRef.current = true;
      navigate("/interview/done");
    } catch {
      if (mountedRef.current) message.error("提交失败，已保存的录音不会丢失，请重试提交。");
    } finally {
      submitBusyRef.current = false;
      if (mountedRef.current) setSubmitting(false);
    }
  }

  const activeStatus =
    phase === "requesting"
      ? "正在获取麦克风"
      : phase === "recording"
        ? "录音中"
        : phase === "stopping"
          ? "正在整理录音"
          : uploadingIndex === currentIndex
            ? "正在保存"
            : activeAnswer?.uploadedUrl
              ? "已保存"
              : activeAnswer
                ? "待保存"
                : "未作答";

  return (
    <InterviewShell
      current="oral"
      title="AI 口试"
      description={
        setName ? `${setName} · 阅读题目后开始录音，保存后可试听和重录。` : "正在准备本次口试套题。"
      }
      oralEnabled={flowConfig?.oral_enabled ?? true}
    >
      {modalContext}
      {loading ? (
        <div className="rounded-xl bg-white p-6">
          <Skeleton active paragraph={{ rows: 5 }} />
        </div>
      ) : loadError ? (
        <Alert
          type="error"
          showIcon
          title="口试套题加载失败"
          description={loadError}
          action={<Button onClick={() => void ensureSession()}>重新加载</Button>}
        />
      ) : (
        <>
          <div className="rounded-xl border border-stone-200 bg-white px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">
                已保存 {completedCount} / {questions.length} 题
              </span>
              <span className="text-sm text-stone-500">
                {canFinish
                  ? "全部录音已就绪，可以提交"
                  : `还剩 ${questions.length - completedCount} 题待保存`}
              </span>
            </div>
            <Progress
              aria-label="口试完成进度"
              percent={questions.length ? Math.round((completedCount / questions.length) * 100) : 0}
              showInfo={false}
              strokeColor="#166534"
              className="!mb-0 !mt-2"
            />
          </div>
          <div className="grid min-w-0 grid-cols-1 items-start gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
            <aside className="order-2 min-w-0 rounded-xl border border-stone-200 bg-white p-3 lg:order-1 lg:sticky lg:top-5">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 p-2 text-left font-medium lg:pointer-events-none"
                aria-expanded={directoryOpen}
                aria-controls="oral-question-directory"
                onClick={() => setDirectoryOpen(!directoryOpen)}
              >
                <span>
                  <UnorderedListOutlined className="mr-2" />
                  题目目录
                </span>
                <DownOutlined className={`transition lg:hidden ${directoryOpen ? "rotate-180" : ""}`} />
              </button>
              <div
                id="oral-question-directory"
                className={`${directoryOpen ? "grid" : "hidden"} mt-2 grid-cols-1 gap-2 lg:grid lg:max-h-[65vh] lg:overflow-y-auto`}
              >
                {questions.map((question, i) => (
                  <button
                    type="button"
                    key={i}
                    disabled={busy}
                    aria-current={i === currentIndex ? "step" : undefined}
                    onClick={() => selectQuestion(i)}
                    className={`rounded-lg border px-3 py-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-60 ${i === currentIndex ? "border-emerald-700 bg-emerald-50" : "border-stone-100 hover:bg-stone-50"}`}
                  >
                    <span className="flex items-center justify-between gap-2 text-sm font-medium">
                      <span>第 {i + 1} 题</span>
                      <span className={recordings[i]?.uploadedUrl ? "text-emerald-700" : "text-stone-500"}>
                        {i === currentIndex && phase !== "idle" ? (
                          activeStatus
                        ) : uploadingIndex === i ? (
                          "保存中"
                        ) : recordings[i]?.uploadedUrl ? (
                          <>
                            <CheckCircleOutlined /> 已保存
                          </>
                        ) : recordings[i] ? (
                          "待保存"
                        ) : (
                          "未作答"
                        )}
                      </span>
                    </span>
                    <span className="mt-1 block line-clamp-2 text-xs leading-5 text-stone-500">
                      {question.replace(/!\[([^\]]*)\]\([^)]*\)/g, "[配图]")}
                    </span>
                  </button>
                ))}
              </div>
              <p className="px-2 pt-3 text-xs leading-5 text-stone-500">
                {busy ? "请先结束录音并等待保存，再切换题目。" : "可切换题目检查答案，已保存的录音会保留。"}
              </p>
            </aside>
            <section className="order-1 min-w-0 space-y-4 lg:order-2">
              <div
                ref={questionRef}
                tabIndex={-1}
                className="scroll-mt-5 rounded-xl border border-stone-200 bg-white p-4 outline-none sm:p-6"
              >
                <div className="mb-4 flex items-center justify-between gap-3">
                  <Tag color="green">
                    第 {currentIndex + 1} / {questions.length} 题
                  </Tag>
                  <span
                    role="status"
                    aria-live="polite"
                    className={`text-sm ${phase === "recording" ? "font-medium text-rose-700" : "text-stone-500"}`}
                  >
                    {phase === "recording" && (
                      <span className="mr-2 inline-block h-2 w-2 rounded-full bg-rose-600 motion-safe:animate-pulse" />
                    )}
                    {activeStatus}
                  </span>
                </div>
                <div className="text-lg font-medium leading-8 text-stone-950 sm:text-xl">
                  <QuestionPrompt content={activeQuestion} />
                </div>
                <div
                  className={`mt-6 rounded-xl border p-4 ${phase === "recording" ? "border-rose-200 bg-rose-50" : "border-stone-200 bg-stone-50"}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <div
                        role="timer"
                        aria-label="录音时长"
                        className={`text-3xl font-semibold tabular-nums ${phase === "recording" ? "text-rose-700" : "text-stone-800"}`}
                      >
                        {formatDuration(
                          phase === "recording" || phase === "stopping"
                            ? elapsed
                            : activeAnswer?.durationSeconds || 0,
                        )}
                      </div>
                      <p className="mt-1 text-xs text-stone-500">
                        {phase === "recording"
                          ? "正在录制你的回答"
                          : activeAnswer
                            ? "本题录音时长"
                            : "准备好后开始作答"}
                      </p>
                    </div>
                    {phase === "recording" ? (
                      <Button
                        danger
                        type="primary"
                        size="large"
                        icon={<StopOutlined />}
                        onClick={() => recorderRef.current?.stop()}
                      >
                        结束并保存
                      </Button>
                    ) : (
                      <Button
                        type="primary"
                        size="large"
                        icon={<AudioOutlined />}
                        loading={phase === "requesting" || phase === "stopping" || uploadingIndex !== null}
                        disabled={busy || Boolean(recordingSupportIssue)}
                        onClick={() => void startRecording()}
                      >
                        {phase === "requesting"
                          ? "等待麦克风授权"
                          : phase === "stopping"
                            ? "整理录音中"
                            : uploadingIndex !== null
                              ? "正在保存录音"
                              : activeAnswer
                                ? "重新录制"
                                : "开始录音"}
                      </Button>
                    )}
                  </div>
                  <p className="mt-3 text-sm leading-6 text-stone-500">
                    {phase === "requesting"
                      ? "请在浏览器弹出的权限提示中允许使用麦克风。"
                      : phase === "recording"
                        ? "回答结束后点击“结束并保存”，保存后可试听或重录。"
                        : uploadingIndex !== null
                          ? "正在上传，请保持页面打开。"
                          : activeAnswer?.uploadedUrl
                            ? "录音已保存。你可以试听确认，再继续下一题。"
                            : "点击开始后才会使用麦克风。建议在安静环境中作答。"}
                  </p>
                </div>
                {(recordingError || recordingSupportIssue) && (
                  <Alert
                    className="!mt-4"
                    showIcon
                    type="warning"
                    title="麦克风暂不可用"
                    description={recordingError || getRecordingSupportMessage(recordingSupportIssue)}
                  />
                )}
                {uploadErrors[currentIndex] && (
                  <Alert
                    className="!mt-4"
                    type="error"
                    showIcon
                    title="录音保存失败"
                    description={uploadErrors[currentIndex]}
                    action={
                      <Button disabled={busy} onClick={() => void persistRecording(activeAnswer)}>
                        重试保存
                      </Button>
                    }
                  />
                )}
                {activeAnswer && phase === "idle" && (
                  <div className="mt-5 border-t border-stone-100 pt-4">
                    <div className="mb-3 flex items-center justify-between text-sm">
                      <span className="font-medium">试听本题录音</span>
                      <Tag color={activeAnswer.uploadedUrl ? "green" : "orange"}>
                        {activeAnswer.uploadedUrl
                          ? "已保存"
                          : uploadingIndex !== null
                            ? "保存中"
                            : "仅保存在当前页面"}
                      </Tag>
                    </div>
                    <audio
                      ref={audioRef}
                      controls
                      preload="metadata"
                      aria-label={`第 ${currentIndex + 1} 题录音试听`}
                      src={activeAnswer.localUrl || resolveAssetUrl(activeAnswer.uploadedUrl || "")}
                      className="w-full"
                    />
                  </div>
                )}
                <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-5">
                  <Button
                    icon={<ArrowLeftOutlined />}
                    disabled={busy || currentIndex === 0}
                    onClick={() => selectQuestion(currentIndex - 1)}
                  >
                    上一题
                  </Button>
                  {currentIndex < questions.length - 1 ? (
                    <Button
                      type={activeAnswer?.uploadedUrl ? "primary" : "default"}
                      disabled={busy}
                      onClick={() => selectQuestion(currentIndex + 1)}
                    >
                      {activeAnswer?.uploadedUrl ? "继续下一题" : "稍后作答，下一题"}
                      <ArrowRightOutlined />
                    </Button>
                  ) : (
                    <Button
                      disabled={busy || completedCount === questions.length}
                      onClick={() =>
                        selectQuestion(questions.findIndex((_, i) => !recordings[i]?.uploadedUrl))
                      }
                    >
                      检查未完成题目
                    </Button>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-stone-200 bg-white px-5 py-4">
                <div>
                  <p className="font-medium">{canFinish ? "所有回答已保存" : "完成全部题目后提交"}</p>
                  <p className="mt-1 text-xs text-stone-500">
                    {completedCount} / {questions.length} 题 · 已保存录音共 {formatDuration(totalDuration)}
                  </p>
                </div>
                <Button
                  size="large"
                  type="primary"
                  icon={<CheckCircleOutlined />}
                  loading={submitting}
                  disabled={!canFinish}
                  onClick={() => void finishInterview()}
                >
                  提交口试
                </Button>
              </div>
            </section>
          </div>
        </>
      )}
    </InterviewShell>
  );
}

function recordingToAnswer(item: OralRecording): RecordedAnswer {
  return {
    questionIndex: item.question_index,
    questionText: item.question_text,
    filename: item.filename,
    durationSeconds: item.duration_seconds,
    recordedAt: item.created_at,
    uploadedUrl: item.url,
  };
}
function getLatestRecording(items: OralRecording[], questionIndex: number, questionText: string) {
  return items
    .filter((item) => item.question_index === questionIndex && item.question_text === questionText)
    .sort((a, b) => new Date(b.created_at).valueOf() - new Date(a.created_at).valueOf())[0];
}
function getRecordingSupportIssue() {
  if (!window.isSecureContext) return "insecure-context";
  if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) return "browser";
  return "";
}
function getRecordingSupportMessage(issue: string) {
  return issue === "insecure-context"
    ? "录音需要安全连接，请使用 https 或 localhost 打开此页面。"
    : "当前浏览器不支持录音，请使用新版 Chrome、Edge 或 Safari。";
}
function recordingErrorMessage(error: unknown) {
  if (error instanceof DOMException) {
    if (["NotAllowedError", "PermissionDeniedError"].includes(error.name))
      return "麦克风权限未开启，请在浏览器地址栏的网站设置中允许麦克风，再点击开始录音。";
    if (error.name === "NotFoundError") return "未找到麦克风，请连接设备后重试。";
    if (error.name === "NotReadableError") return "麦克风可能被其他应用占用，请关闭占用麦克风的应用后重试。";
  }
  return error instanceof Error ? error.message : "录音启动失败，请检查麦克风后重试。";
}
function getSupportedMimeType() {
  return (
    ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((type) =>
      MediaRecorder.isTypeSupported(type),
    ) || ""
  );
}
function getAudioExtension(type: string) {
  return type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
}
function formatDuration(value: number) {
  return `${Math.floor(value / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(value % 60)
    .toString()
    .padStart(2, "0")}`;
}
