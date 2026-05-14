export type Stage = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface Company {
  name: string;
  stage: string;
  description: string;
  domain: string;
  why_fit: string;
  website?: string;
  size?: string;
}

export interface KeptCompany {
  company: Company;
  reason: string;
}

export interface SkippedCompany {
  company: Company;
  reasons: string[];
  freeText: string;
}

export interface SuggestedPerson {
  name: string | null;
  role: string;
  linkedinSearchUrl: string;
  isKnown: boolean;
}

export interface OutreachTarget {
  company: Company;
  person: SuggestedPerson;
  draft: string;
  status: "pending" | "sent" | "skipped";
}

export interface Debrief {
  date: number;
  surprise: string;
  selfLearning: string;
  marketLearning: string;
}

export interface Contact {
  id: string;
  name: string;
  company: string;
  linkedinUrl?: string;
  stage: "drafted" | "sent" | "replied" | "meeting_prep" | "debrief_pending" | "done";
  draftSavedAt: number;
  replySentiment?: "positive" | "rejection";
  replyText?: string;
  meetingDate?: string;
  prepCompleted: boolean;
  debriefs: Debrief[];
}

export const SCHEMA_VERSION = 1;

export interface AppState {
  schemaVersion: typeof SCHEMA_VERSION;
  hypothesis: string;
  learningsSummary: string;
  contacts: Contact[];
}
