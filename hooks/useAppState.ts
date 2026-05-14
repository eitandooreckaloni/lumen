import { useState, useCallback } from "react";
import { AppState, Contact, Debrief, SCHEMA_VERSION } from "../lib/types";

const STORAGE_KEY = "lumenState";

function loadFromStorage(): AppState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppState;
    if (parsed.schemaVersion !== SCHEMA_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveToStorage(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // storage quota exceeded or private browsing — degrade silently
  }
}

function emptyAppState(hypothesis: string): AppState {
  return {
    schemaVersion: SCHEMA_VERSION,
    hypothesis,
    learningsSummary: "",
    contacts: [],
  };
}

export function mostUrgentContact(contacts: Contact[]): Contact | null {
  const priority: Record<Contact["stage"], number> = {
    debrief_pending: 0,
    meeting_prep: 1,
    replied: 2,
    sent: 3,
    drafted: 4,
    done: 5,
  };
  const active = contacts.filter((c) => c.stage !== "done");
  if (active.length === 0) return null;
  return active.sort(
    (a, b) => priority[a.stage] - priority[b.stage] || a.draftSavedAt - b.draftSavedAt
  )[0];
}

export function useAppState() {
  const [appState, setAppStateRaw] = useState<AppState | null>(null);

  const loadAppState = useCallback((): AppState | null => {
    const stored = loadFromStorage();
    if (stored) setAppStateRaw(stored);
    return stored;
  }, []);

  const initAppState = useCallback((hypothesis: string): AppState => {
    const state = emptyAppState(hypothesis);
    setAppStateRaw(state);
    saveToStorage(state);
    return state;
  }, []);

  const addContact = useCallback((contact: Contact) => {
    setAppStateRaw((prev) => {
      if (!prev) return prev;
      const next = { ...prev, contacts: [...prev.contacts, contact] };
      saveToStorage(next);
      return next;
    });
  }, []);

  const updateContact = useCallback((id: string, update: Partial<Contact>) => {
    setAppStateRaw((prev) => {
      if (!prev) return prev;
      const next = {
        ...prev,
        contacts: prev.contacts.map((c) => (c.id === id ? { ...c, ...update } : c)),
      };
      saveToStorage(next);
      return next;
    });
  }, []);

  const addDebrief = useCallback((contactId: string, debrief: Debrief) => {
    setAppStateRaw((prev) => {
      if (!prev) return prev;
      const next = {
        ...prev,
        contacts: prev.contacts.map((c) =>
          c.id === contactId
            ? { ...c, debriefs: [...c.debriefs, debrief], stage: "done" as const }
            : c
        ),
      };
      saveToStorage(next);
      return next;
    });
  }, []);

  const updateLearnings = useCallback((learningsSummary: string, hypothesis?: string) => {
    setAppStateRaw((prev) => {
      if (!prev) return prev;
      const next = {
        ...prev,
        learningsSummary,
        ...(hypothesis ? { hypothesis } : {}),
      };
      saveToStorage(next);
      return next;
    });
  }, []);

  return {
    appState,
    loadAppState,
    initAppState,
    addContact,
    updateContact,
    addDebrief,
    updateLearnings,
  };
}
