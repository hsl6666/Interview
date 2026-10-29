export type WorkExperience = {
  start_date: string;
  end_date: string;
  company: string;
  salary: string;
  position: string;
  leave_reason: string;
};

export type EducationExperience = {
  start_date: string;
  end_date: string;
  college: string;
  major: string;
  certificate: string;
};

export type FamilyMember = {
  relation: string;
  company: string;
  address: string;
};

export type CandidateProfile = {
  profile_photo_data_url: string;
  name: string;
  age: string;
  id_number: string;
  phone: string;
  email: string;
  role: string;
  fill_date: string;
  gender: string;
  birth_month: string;
  nation: string;
  native_place: string;
  height: string;
  weight: string;
  marital_status: string;
  political_status: string;
  education_level: string;
  school: string;
  major: string;
  degree: string;
  graduation_year: string;
  registered_address: string;
  current_address: string;
  work_experiences: WorkExperience[];
  education_experiences: EducationExperience[];
  family_members: FamilyMember[];
  emergency_contact: string;
  emergency_relation: string;
  emergency_phone: string;
  expected_salary: string;
  previous_leave_reason: string;
  career_plan: string;
  self_evaluation: string;
};

export type Attachment = {
  id: string;
  filename: string;
  content_type: string;
  url: string;
  created_at: string;
};

export type Snapshot = {
  id: string;
  filename: string;
  url: string;
  capture_index: number;
  capture_reason: string;
  created_at: string;
};

export type OralRecording = {
  id: string;
  question_index: number;
  question_text: string;
  filename: string;
  content_type: string;
  url: string;
  duration_seconds: number;
  created_at: string;
};

export type Transcript = {
  id: number;
  speaker: "user" | "assistant";
  text: string;
  event_type: string;
  created_at: string;
};

export type InterviewSession = {
  id: string;
  role: string;
  status: string;
  candidate_profile: Partial<CandidateProfile>;
  parsed_profile: Partial<CandidateProfile>;
  resume_text: string;
  written_submission: Record<string, unknown>;
  oral_summary: Record<string, unknown>;
  attachments: Attachment[];
  transcripts: Transcript[];
  snapshots: Snapshot[];
  oral_recordings: OralRecording[];
  created_at: string;
  updated_at: string;
};

export type QuestionType = "single" | "multi" | "short" | "code";

export type Question = {
  id: string;
  title: string;
  type: QuestionType;
  options: Array<{ label: string; value: string }>;
  prompt: string;
  starter_code: string;
  language: string;
};

export type WrittenQuestion = Question & {
  role_tags: string;
  difficulty: string;
  source: string;
  evaluation_points: string;
  published: boolean;
  created_at: string;
  updated_at: string;
};

export type OralQuestion = {
  id: string;
  set_id: string;
  title: string;
  prompt: string;
  role_tags: string;
  difficulty: string;
  source: string;
  sort_order: number;
  published: boolean;
  created_at: string;
  updated_at: string;
};

export type OralQuestionSet = {
  id: string;
  name: string;
  description: string;
  published: boolean;
  is_active: boolean;
  question_count: number;
  published_question_count: number;
  created_at: string;
  updated_at: string;
};

export type OralQuestionSetCreate = {
  name: string;
  description: string;
  question_ids?: string[];
};

export type OralQuestionSnapshot = {
  set_id: string;
  set_name: string;
  questions: OralQuestion[];
};

export type JobPosition = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type JobPositionCreate = {
  name: string;
  description?: string;
  enabled?: boolean;
  sort_order?: number;
};

export type JobPositionUpdate = Partial<JobPositionCreate>;

export type QuestionGenerationRequest = {
  role: string;
  count: number;
  system_prompt: string;
  user_prompt: string;
  difficulty: string;
  question_types: QuestionType[];
};

export type QuestionGenerationResponse = {
  questions: Question[];
  system_prompt: string;
  fallback_used: boolean;
};

export type LlmProvider = "zhipu" | "openai" | "deepseek" | "qwen" | "custom";

export type LlmModelConfig = {
  provider: LlmProvider;
  model: string;
  api_base_url: string;
  enabled: boolean;
  has_api_key: boolean;
  api_key_masked: string;
  updated_at: string;
};

export type ModelConnectionResult = {
  success: boolean;
  model: string;
  latency_ms: number;
  code: string;
  message: string;
  http_status?: number;
};

export type LlmModelConfigUpdate = {
  provider: LlmProvider;
  model: string;
  api_base_url: string;
  api_key?: string;
  enabled: boolean;
  clear_api_key?: boolean;
};

export type InterviewFlowConfig = {
  oral_enabled: boolean;
  assistant_system_prompt: string;
  assistant_user_prompt: string;
  updated_at: string;
};

export type InterviewFlowConfigUpdate = {
  oral_enabled: boolean;
  assistant_system_prompt: string;
  assistant_user_prompt: string;
};

export type WrittenAnswers = Record<string, string | string[]>;

export type WrittenExamSubmission = {
  session_id: string;
  role: string;
  started_at: string;
  submitted_at: string;
  duration_seconds: number;
  answers: WrittenAnswers;
};

export type OralMessage = {
  id: string;
  speaker: "user" | "assistant";
  text: string;
  createdAt: string;
};

export type RiskLevel = "low" | "medium" | "high";

export type InterviewResultSummary = {
  session_id: string;
  name: string;
  role: string;
  phone: string;
  email: string;
  status: string;
  total_score: number;
  written_score: number;
  oral_score: number;
  profile_score: number;
  risk_level: RiskLevel;
  recommendation: string;
  attachments_count: number;
  snapshots_count: number;
  recordings_count: number;
  qa_count: number;
  updated_at: string;
};

export type ScoreBreakdown = {
  total_score: number;
  profile_score: number;
  written_score: number;
  oral_score: number;
  compliance_score: number;
};

export type ReportQaPair = {
  question: string;
  answer: string;
  audio_url?: string;
  duration_seconds?: number;
  at: string;
};

export type InterviewResultDetail = {
  summary: InterviewResultSummary;
  candidate_profile: Partial<CandidateProfile>;
  parsed_profile: Partial<CandidateProfile>;
  score_breakdown: ScoreBreakdown;
  report: {
    title: string;
    conclusion: string;
    overall_comment: string;
    strengths: string[];
    risks: string[];
    dimension_analysis: Array<{
      dimension: string;
      score: number;
      comment: string;
    }>;
    qa_pairs: ReportQaPair[];
  };
};

export type AssistantChatMessage = {
  role: "user" | "assistant";
  content: string;
  sql_used?: string;
  warning?: string;
};

export type AssistantChatResponse = {
  answer: string;
  sql_used: string;
  warning: string;
};

export type AssistantStreamChunk = {
  type: "chunk" | "done" | "error";
  content?: string;
  sql_used?: string;
  warning?: string;
  detail?: string;
};
