import axios from "axios";
import type {
  CandidateProfile,
  AssistantChatMessage,
  AssistantChatResponse,
  AssistantStreamChunk,
  InterviewResultDetail,
  InterviewResultSummary,
  InterviewSession,
  InterviewFlowConfig,
  InterviewFlowConfigUpdate,
  JobPosition,
  JobPositionCreate,
  JobPositionUpdate,
  LlmModelConfig,
  LlmModelConfigUpdate,
  ModelConnectionResult,
  OralQuestion,
  OralQuestionSet,
  OralQuestionSetCreate,
  OralQuestionSnapshot,
  Question,
  QuestionGenerationRequest,
  QuestionGenerationResponse,
  WrittenExamSubmission,
  WrittenQuestion,
} from "./types";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8010";
export const PUBLIC_BASE_URL = import.meta.env.VITE_PUBLIC_BASE_URL || API_BASE_URL;

const client = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30_000,
});

export async function createOrUpdateSession(sessionId: string, profile: CandidateProfile) {
  const { data } = await client.post<InterviewSession>("/api/sessions", {
    session_id: sessionId,
    role: profile.role,
    candidate_profile: profile,
  });
  return data;
}

export async function patchSession(sessionId: string, profile: CandidateProfile) {
  const { data } = await client.patch<InterviewSession>(`/api/sessions/${sessionId}`, {
    role: profile.role,
    candidate_profile: profile,
  });
  return data;
}

export async function fetchSession(sessionId: string) {
  const { data } = await client.get<InterviewSession>(`/api/sessions/${sessionId}`);
  return data;
}

export async function uploadResumeAttachment(sessionId: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  const { data } = await client.post<InterviewSession>(`/api/sessions/${sessionId}/attachments`, form);
  return data;
}

export async function fetchInterviewResults() {
  const { data } = await client.get<InterviewResultSummary[]>("/api/interview-results");
  return data;
}

export async function fetchInterviewResultDetail(sessionId: string) {
  const { data } = await client.get<InterviewResultDetail>(`/api/interview-results/${sessionId}`);
  return data;
}

export async function chatWithInterviewAssistant(sessionId: string, messages: AssistantChatMessage[]) {
  const { data } = await client.post<AssistantChatResponse>("/api/admin/interview-assistant/chat", {
    session_id: sessionId,
    messages: messages.map((item) => ({ role: item.role, content: item.content })),
  });
  return data;
}

export async function streamChatWithInterviewAssistant(
  sessionId: string,
  messages: AssistantChatMessage[],
  handlers: {
    onChunk: (chunk: AssistantStreamChunk) => void;
    onDone: (chunk: AssistantStreamChunk) => void;
  },
) {
  const response = await fetch(`${API_BASE_URL}/api/admin/interview-assistant/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      messages: messages.map((item) => ({ role: item.role, content: item.content })),
    }),
  });

  if (!response.ok || !response.body) {
    let detail = "智能体回答失败，请确认模型配置和后端服务可用";
    try {
      const data = await response.json();
      if (typeof data?.detail === "string" && data.detail) detail = data.detail;
    } catch {
      // ignore non-json error payloads
    }
    throw new Error(detail);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  function consumeFrame(frame: string) {
    const dataLine = frame
      .split("\n")
      .find((line) => line.startsWith("data:"));
    if (!dataLine) return;
    const payload = JSON.parse(dataLine.slice(5).trim()) as AssistantStreamChunk;
    if (payload.type === "error") {
      throw new Error(payload.detail || "智能体回答失败，请稍后重试");
    }
    if (payload.type === "chunk") {
      handlers.onChunk(payload);
    } else if (payload.type === "done") {
      handlers.onDone(payload);
    }
  }

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

    const frames = buffer.split("\n\n");
    buffer = frames.pop() || "";

    for (const frame of frames) {
      consumeFrame(frame);
    }

    if (done) {
      if (buffer.trim()) consumeFrame(buffer);
      break;
    }
  }
}

export async function deleteInterviewResult(sessionId: string) {
  await client.delete(`/api/interview-results/${sessionId}`);
}

export async function deleteAllInterviewResults() {
  const { data } = await client.delete<{ deleted_count: number }>("/api/interview-results");
  return data;
}

export async function deleteOralRecording(sessionId: string, recordingId: string) {
  await client.delete(`/api/sessions/${sessionId}/oral-recordings/${recordingId}`);
}

export async function fetchQuestions(role: string) {
  const { data } = await client.get<Question[]>("/api/questions", { params: { role } });
  return data;
}

export async function fetchOralQuestions(role: string) {
  const { data } = await client.get<OralQuestion[]>("/api/oral-questions", { params: { role } });
  return data;
}

export async function fetchSessionOralQuestionSet(sessionId: string) {
  const { data } = await client.get<OralQuestionSnapshot>(`/api/sessions/${sessionId}/oral-question-set`);
  return data;
}

export async function fetchAdminOralQuestionSets() {
  const { data } = await client.get<OralQuestionSet[]>("/api/admin/oral-question-sets");
  return data;
}

export async function createAdminOralQuestionSet(payload: OralQuestionSetCreate) {
  const { data } = await client.post<OralQuestionSet>("/api/admin/oral-question-sets", payload);
  return data;
}

export async function updateAdminOralQuestionSet(setId: string, payload: Partial<Pick<OralQuestionSet, "name" | "description" | "published">>) {
  const { data } = await client.patch<OralQuestionSet>(`/api/admin/oral-question-sets/${setId}`, payload);
  return data;
}

export async function activateAdminOralQuestionSet(setId: string) {
  const { data } = await client.post<OralQuestionSet>(`/api/admin/oral-question-sets/${setId}/activate`);
  return data;
}

export async function deleteAdminOralQuestionSet(setId: string) {
  await client.delete(`/api/admin/oral-question-sets/${setId}`);
}

export async function fetchPositions() {
  const { data } = await client.get<JobPosition[]>("/api/positions");
  return data;
}

export async function fetchAdminPositions() {
  const { data } = await client.get<JobPosition[]>("/api/admin/positions");
  return data;
}

export async function createAdminPosition(payload: JobPositionCreate) {
  const { data } = await client.post<JobPosition>("/api/admin/positions", payload);
  return data;
}

export async function updateAdminPosition(positionId: string, payload: JobPositionUpdate) {
  const { data } = await client.patch<JobPosition>(`/api/admin/positions/${positionId}`, payload);
  return data;
}

export async function deleteAdminPosition(positionId: string) {
  const { data } = await client.delete<{ ok: boolean }>(`/api/admin/positions/${positionId}`);
  return data;
}

export async function fetchAdminWrittenQuestions() {
  const { data } = await client.get<WrittenQuestion[]>("/api/admin/written-questions");
  return data;
}

export async function createAdminWrittenQuestion(
  payload: Omit<WrittenQuestion, "id" | "created_at" | "updated_at">,
) {
  const { data } = await client.post<WrittenQuestion>("/api/admin/written-questions", payload);
  return data;
}

export async function updateAdminWrittenQuestion(
  questionId: string,
  payload: Partial<Omit<WrittenQuestion, "id" | "created_at" | "updated_at">>,
) {
  const { data } = await client.patch<WrittenQuestion>(`/api/admin/written-questions/${questionId}`, payload);
  return data;
}

export async function deleteAdminWrittenQuestion(questionId: string) {
  const { data } = await client.delete<{ ok: boolean }>(`/api/admin/written-questions/${questionId}`);
  return data;
}

export async function fetchAdminOralQuestions(setId?: string) {
  const { data } = await client.get<OralQuestion[]>("/api/admin/oral-questions", { params: { set_id: setId } });
  return data;
}

export async function createAdminOralQuestion(
  payload: Omit<OralQuestion, "id" | "created_at" | "updated_at">,
) {
  const { data } = await client.post<OralQuestion>("/api/admin/oral-questions", payload);
  return data;
}

export async function updateAdminOralQuestion(
  questionId: string,
  payload: Partial<Omit<OralQuestion, "id" | "set_id" | "created_at" | "updated_at">>,
) {
  const { data } = await client.patch<OralQuestion>(`/api/admin/oral-questions/${questionId}`, payload);
  return data;
}

export async function deleteAdminOralQuestion(questionId: string) {
  const { data } = await client.delete<{ ok: boolean }>(`/api/admin/oral-questions/${questionId}`);
  return data;
}

export async function generateAdminWrittenQuestions(payload: QuestionGenerationRequest) {
  const { data } = await client.post<QuestionGenerationResponse>(
    "/api/admin/written-questions/generate",
    payload,
    { timeout: 120_000 },
  );
  return data;
}

export async function fetchAdminModelConfig() {
  const { data } = await client.get<LlmModelConfig>("/api/admin/model-config");
  return data;
}

export async function updateAdminModelConfig(payload: LlmModelConfigUpdate) {
  const { data } = await client.put<LlmModelConfig>("/api/admin/model-config", payload);
  return data;
}

export async function fetchInterviewConfig() {
  const { data } = await client.get<InterviewFlowConfig>("/api/interview-config");
  return data;
}

export async function fetchAdminInterviewConfig() {
  const { data } = await client.get<InterviewFlowConfig>("/api/admin/interview-config");
  return data;
}

export async function updateAdminInterviewConfig(payload: InterviewFlowConfigUpdate) {
  const { data } = await client.put<InterviewFlowConfig>("/api/admin/interview-config", payload);
  return data;
}

export async function submitWrittenExam(sessionId: string, payload: WrittenExamSubmission) {
  const { data } = await client.post<InterviewSession>(
    `/api/sessions/${sessionId}/written-submission`,
    payload,
  );
  return data;
}

export async function sendRtcOffer(sessionId: string, offer: RTCSessionDescriptionInit) {
  const { data } = await client.post<RTCSessionDescriptionInit>("/api/rtc/offer", {
    session_id: sessionId,
    sdp: offer.sdp,
    type: offer.type,
  });
  return data;
}

export async function startOralInterview(sessionId: string) {
  const { data } = await client.post<{ assistant_text: string; stage: string }>(
    `/api/sessions/${sessionId}/oral/start`,
    { session_id: sessionId },
  );
  return data;
}

export async function respondOralInterview(sessionId: string, text: string) {
  const { data } = await client.post<{ assistant_text: string; stage: string }>(
    `/api/sessions/${sessionId}/oral/respond`,
    { session_id: sessionId, text },
  );
  return data;
}

export async function uploadSnapshot(sessionId: string, blob: Blob, captureIndex: number) {
  const form = new FormData();
  form.append("capture_index", String(captureIndex));
  form.append("file", blob, `snapshot-${captureIndex}.jpg`);
  const { data } = await client.post<InterviewSession>(`/api/sessions/${sessionId}/snapshots`, form);
  return data;
}

export async function uploadOralRecording({
  sessionId,
  questionIndex,
  questionText,
  durationSeconds,
  blob,
  filename,
}: {
  sessionId: string;
  questionIndex: number;
  questionText: string;
  durationSeconds: number;
  blob: Blob;
  filename: string;
}) {
  const form = new FormData();
  form.append("question_index", String(questionIndex));
  form.append("question_text", questionText);
  form.append("duration_seconds", String(durationSeconds));
  form.append("file", blob, filename);
  const { data } = await client.post<InterviewSession>(`/api/sessions/${sessionId}/oral-recordings`, form);
  return data;
}

export async function saveOralSummary(sessionId: string, qa: unknown[]) {
  const { data } = await client.post<InterviewSession>(`/api/sessions/${sessionId}/oral-summary`, {
    session_id: sessionId,
    qa,
    ended_at: new Date().toISOString(),
  });
  return data;
}

export function resolveAssetUrl(url: string) {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  return `${API_BASE_URL}${url}`;
}

export async function testAdminModelConnection() {
  const { data } = await client.post<ModelConnectionResult>("/api/admin/model-config/test", undefined, { timeout: 30_000 });
  return data;
}
