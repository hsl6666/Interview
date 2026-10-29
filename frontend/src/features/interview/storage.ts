import dayjs from "dayjs";
import type {
  CandidateProfile,
  EducationExperience,
  FamilyMember,
  WorkExperience,
  WrittenAnswers,
} from "./types";

const SESSION_KEY = "ai-interview-session-id";
const PROFILE_PREFIX = "ai-interview-profile:";
const ANSWERS_PREFIX = "ai-interview-answers:";
const ORAL_PREFIX = "ai-interview-oral:";

export const emptyProfile: CandidateProfile = {
  profile_photo_data_url: "",
  name: "",
  age: "",
  id_number: "",
  phone: "",
  email: "",
  role: "",
  fill_date: dayjs().format("YYYY-MM-DD"),
  gender: "",
  birth_month: "",
  nation: "",
  native_place: "",
  height: "",
  weight: "",
  marital_status: "",
  political_status: "",
  education_level: "",
  school: "",
  major: "",
  degree: "",
  graduation_year: "",
  registered_address: "",
  current_address: "",
  work_experiences: createRows(createEmptyWorkExperience, 3),
  education_experiences: createRows(createEmptyEducationExperience, 3),
  family_members: createRows(createEmptyFamilyMember, 3),
  emergency_contact: "",
  emergency_relation: "",
  emergency_phone: "",
  expected_salary: "",
  previous_leave_reason: "",
  career_plan: "",
  self_evaluation: "",
};

export function getInterviewSessionId() {
  const existing = localStorage.getItem(SESSION_KEY);
  if (existing) return existing;
  const next = createSessionId();
  localStorage.setItem(SESSION_KEY, next);
  return next;
}

export function getBasicEntrySessionId() {
  if (isReloadNavigation()) {
    return getInterviewSessionId();
  }
  return resetInterviewSession();
}

export function resetInterviewSession() {
  const next = createSessionId();
  localStorage.setItem(SESSION_KEY, next);
  return next;
}

export function loadProfile(sessionId: string): CandidateProfile {
  const value = localStorage.getItem(`${PROFILE_PREFIX}${sessionId}`);
  if (!value) return normalizeProfile({});
  try {
    return normalizeProfile(JSON.parse(value) as Partial<CandidateProfile>);
  } catch {
    return normalizeProfile({});
  }
}

export function saveProfile(sessionId: string, profile: CandidateProfile) {
  localStorage.setItem(`${PROFILE_PREFIX}${sessionId}`, JSON.stringify(profile));
}

export function loadAnswers(sessionId: string): WrittenAnswers {
  const value = localStorage.getItem(`${ANSWERS_PREFIX}${sessionId}`);
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

export function saveAnswers(sessionId: string, answers: WrittenAnswers) {
  localStorage.setItem(`${ANSWERS_PREFIX}${sessionId}`, JSON.stringify(answers));
}

export function saveOralMessages(sessionId: string, messages: unknown[]) {
  localStorage.setItem(`${ORAL_PREFIX}${sessionId}`, JSON.stringify(messages));
}

export function normalizeProfile(profile: Partial<CandidateProfile>): CandidateProfile {
  return {
    ...emptyProfile,
    ...profile,
    fill_date: profile.fill_date || dayjs().format("YYYY-MM-DD"),
    work_experiences: normalizeWorkRows(profile.work_experiences, 3),
    education_experiences: normalizeEducationRows(profile.education_experiences, 3),
    family_members: normalizeRows(profile.family_members, createEmptyFamilyMember, 3),
  };
}

function normalizeRows<T>(rows: Array<Partial<T>> | undefined, factory: () => T, count: number): T[] {
  const normalized = Array.isArray(rows) ? rows.slice(0, count).map((row) => ({ ...factory(), ...row })) : [];
  while (normalized.length < count) normalized.push(factory());
  return normalized;
}

function createRows<T>(factory: () => T, count: number) {
  return Array.from({ length: count }, factory);
}

function createEmptyWorkExperience(): WorkExperience {
  return { start_date: "", end_date: "", company: "", salary: "", position: "", leave_reason: "" };
}

function createEmptyEducationExperience(): EducationExperience {
  return { start_date: "", end_date: "", college: "", major: "", certificate: "" };
}

function createEmptyFamilyMember(): FamilyMember {
  return { relation: "", company: "", address: "" };
}

function createSessionId() {
  const browserCrypto = globalThis.crypto;
  if (typeof browserCrypto?.randomUUID === "function") {
    return browserCrypto.randomUUID();
  }

  if (typeof browserCrypto?.getRandomValues === "function") {
    const bytes = browserCrypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
  }

  return `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isReloadNavigation() {
  const navigationEntries = performance.getEntriesByType("navigation");
  const navigationEntry = navigationEntries[0] as PerformanceNavigationTiming | undefined;
  if (navigationEntry) {
    return navigationEntry.type === "reload";
  }

  const legacyNavigation = performance.navigation;
  return legacyNavigation?.type === 1;
}

function normalizeWorkRows(
  rows: Array<Partial<WorkExperience> & { start_month?: string; end_month?: string }> | undefined,
  count: number,
) {
  const normalized = Array.isArray(rows)
    ? rows.slice(0, count).map((row) => ({
        start_date: row.start_date || row.start_month || "",
        end_date: row.end_date || row.end_month || "",
        company: row.company || "",
        salary: row.salary || "",
        position: row.position || "",
        leave_reason: row.leave_reason || "",
      }))
    : [];
  while (normalized.length < count) normalized.push(createEmptyWorkExperience());
  return normalized;
}

function normalizeEducationRows(
  rows: Array<Partial<EducationExperience> & { start_month?: string; end_month?: string }> | undefined,
  count: number,
) {
  const normalized = Array.isArray(rows)
    ? rows.slice(0, count).map((row) => ({
        start_date: row.start_date || row.start_month || "",
        end_date: row.end_date || row.end_month || "",
        college: row.college || "",
        major: row.major || "",
        certificate: row.certificate || "",
      }))
    : [];
  while (normalized.length < count) normalized.push(createEmptyEducationExperience());
  return normalized;
}
