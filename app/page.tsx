"use client";

import { useState, useRef, useEffect } from "react";
import type { Stage, Message, Company, KeptCompany, SkippedCompany, SuggestedPerson, OutreachTarget, Contact } from "../lib/types";
import {
  STAGE_1_SYSTEM,
  getStage2System,
  getStage3PeopleSystem,
  getStage4DraftSystem,
  getStage6SentimentSystem,
  getStage6CelebrationSystem,
  getStage6RejectionSystem,
  getStage7PrepSystem,
  DEBRIEF_QUESTIONS,
  getStage8SynthesisSystem,
  getCompressionSystem,
} from "../lib/prompts";
import { useAppState, mostUrgentContact } from "../hooks/useAppState";
import { PrepCard } from "../components/PrepCard";

// ─── Stream helper ────────────────────────────────────────────────────────────

async function streamClaude(
  messages: Message[],
  systemPrompt: string,
  onChunk: (text: string) => void
): Promise<string> {
  const response = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, systemPrompt }),
  });

  if (!response.ok) throw new Error(`API error ${response.status}`);

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let fullText = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") return fullText;
      try {
        const parsed = JSON.parse(data);
        if (parsed.text) {
          fullText += parsed.text;
          onChunk(parsed.text);
        }
      } catch {
        // ignore malformed chunks
      }
    }
  }

  return fullText;
}

// ─── Markdown renderer ────────────────────────────────────────────────────────

function renderMarkdown(text: string): React.ReactNode {
  // Handle newlines first by splitting into paragraphs
  const lines = text.split("\n");
  return lines.map((line, lineIdx) => {
    // Process bold (**text**) and italic (*text*)
    const segments: React.ReactNode[] = [];
    const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(line)) !== null) {
      if (match.index > last) segments.push(line.slice(last, match.index));
      const raw = match[0];
      if (raw.startsWith("**")) {
        segments.push(<strong key={match.index}>{raw.slice(2, -2)}</strong>);
      } else {
        segments.push(<em key={match.index}>{raw.slice(1, -1)}</em>);
      }
      last = match.index + raw.length;
    }
    if (last < line.length) segments.push(line.slice(last));
    return (
      <span key={lineIdx}>
        {segments}
        {lineIdx < lines.length - 1 && <br />}
      </span>
    );
  });
}

// ─── Stage indicator ──────────────────────────────────────────────────────────

const STAGE_LABELS = ["Interview", "Companies", "People", "Draft", "Done"];

function StageIndicator({ stage }: { stage: Stage }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      {STAGE_LABELS.map((label, i) => {
        const n = (i + 1) as Stage;
        const active = n === stage;
        const done = n < stage;
        return (
          <div key={n} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, opacity: done ? 0.4 : active ? 1 : 0.3 }}>
              <div style={{
                width: 22, height: 22, borderRadius: "50%",
                background: active ? "var(--accent)" : done ? "var(--muted)" : "transparent",
                border: active ? "none" : "1.5px solid var(--line-2, rgba(26,26,26,0.2))",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 600,
                color: active ? "#fff" : done ? "#fff" : "var(--muted)",
                fontFamily: "var(--mono)",
              }}>
                {done ? "✓" : n}
              </div>
              <span style={{
                fontSize: 12, fontFamily: "var(--mono)", letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: active ? "var(--ink)" : "var(--muted)",
                fontWeight: active ? 600 : 400,
              }}>
                {label}
              </span>
            </div>
            {i < STAGE_LABELS.length - 1 && (
              <div style={{ width: 20, height: 1, background: "var(--line)" }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Chat bubble ─────────────────────────────────────────────────────────────

function ChatBubble({ message, isStreaming }: { message: Message; isStreaming?: boolean }) {
  const isUser = message.role === "user";
  return (
    <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start", marginBottom: 12 }}>
      <div style={{
        maxWidth: "75%", padding: "12px 16px",
        borderRadius: isUser ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
        background: isUser ? "var(--accent)" : "var(--paper)",
        color: isUser ? "#fff" : "var(--ink)",
        fontSize: 15, lineHeight: 1.6, fontFamily: "var(--serif)",
        boxShadow: isUser ? "none" : "0 1px 3px rgba(0,0,0,0.08)",
        border: isUser ? "none" : "1px solid var(--line)",
        whiteSpace: "pre-wrap",
      }}>
        {renderMarkdown(message.content)}
        {isStreaming && (
          <span style={{ display: "inline-block", width: 2, height: "1em", background: "currentColor", marginLeft: 2, verticalAlign: "text-bottom", animation: "blink 1s step-end infinite" }} />
        )}
      </div>
    </div>
  );
}

// ─── LinkedIn icon ────────────────────────────────────────────────────────────

function LinkedInIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

// ─── Company card ─────────────────────────────────────────────────────────────

function CompanyCard({
  company, onKeep, onSkip, current, total, pendingDecision, onFeedback, totalReviewed,
}: {
  company: Company;
  onKeep: () => void;
  onSkip: () => void;
  current: number;
  total: number;
  pendingDecision: "keep" | "skip" | null;
  onFeedback: (reasons: string[], freeText: string) => void;
  totalReviewed: number;
}) {
  const [selectedReasons, setSelectedReasons] = useState<string[]>([]);
  const [freeText, setFreeText] = useState("");

  const keepReasons = ["Strong product fit", "Interesting tech", "Fast growing", "Right culture"];
  const skipReasons = ["Wrong domain", "Too large", "Too early/late", "Not interesting"];
  const showChips = totalReviewed >= 5;
  const canSubmit = selectedReasons.length > 0 || freeText.trim().length > 0;

  const toggleReason = (reason: string) =>
    setSelectedReasons((prev) =>
      prev.includes(reason) ? prev.filter((r) => r !== reason) : [...prev, reason]
    );

  const websiteHref = company.website
    ? company.website.startsWith("http") ? company.website : `https://${company.website}`
    : null;

  return (
    <div style={{ background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 16, padding: 28, maxWidth: 480, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 600, fontFamily: "var(--serif)", color: "var(--ink)", marginBottom: 4 }}>
            {company.name}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <span style={{ fontSize: 11, fontFamily: "var(--mono)", letterSpacing: "0.1em", textTransform: "uppercase", background: "rgba(184, 84, 80, 0.1)", color: "var(--accent)", padding: "2px 8px", borderRadius: 4 }}>
              {company.stage}
            </span>
            <span style={{ fontSize: 11, fontFamily: "var(--mono)", letterSpacing: "0.1em", textTransform: "uppercase", background: "rgba(26,26,26,0.06)", color: "var(--muted)", padding: "2px 8px", borderRadius: 4 }}>
              {company.domain}
            </span>
          </div>
        </div>
        <div style={{ fontSize: 12, fontFamily: "var(--mono)", color: "var(--muted)" }}>
          {current}/{total}
        </div>
      </div>

      <p style={{ fontSize: 15, lineHeight: 1.6, color: "var(--ink-2)", fontFamily: "var(--serif)", marginBottom: 8 }}>
        {company.description}
      </p>

      {(websiteHref || company.size) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 12 }}>
          {websiteHref && (
            <a
              href={websiteHref}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 12, fontFamily: "var(--mono)", color: "var(--muted)", textDecoration: "none" }}
            >
              ↗ {company.website}
            </a>
          )}
          {company.size && (
            <span style={{ fontSize: 12, fontFamily: "var(--mono)", color: "var(--muted)" }}>
              {company.size}
            </span>
          )}
        </div>
      )}

      <div style={{ background: "rgba(184, 84, 80, 0.06)", borderRadius: 8, padding: "10px 14px", marginBottom: 24, borderLeft: "3px solid var(--accent)" }}>
        <p style={{ fontSize: 13, lineHeight: 1.5, color: "var(--ink)", fontFamily: "var(--sans)", margin: 0 }}>
          {company.why_fit}
        </p>
      </div>

      {!pendingDecision ? (
        <div style={{ display: "flex", gap: 12 }}>
          <button
            onClick={onSkip}
            style={{ flex: 1, padding: "12px", borderRadius: 10, border: "1.5px solid var(--line)", background: "transparent", fontSize: 14, fontFamily: "var(--sans)", color: "var(--muted)", cursor: "pointer", fontWeight: 500 }}
          >
            Not so interesting
          </button>
          <button
            onClick={onKeep}
            style={{ flex: 1, padding: "12px", borderRadius: 10, border: "none", background: "var(--accent)", fontSize: 14, fontFamily: "var(--sans)", color: "#fff", cursor: "pointer", fontWeight: 600 }}
          >
            Seems interesting →
          </button>
        </div>
      ) : (
        <div style={{ animation: "fadeIn 0.25s ease" }}>
          <div style={{ fontSize: 12, fontFamily: "var(--mono)", letterSpacing: "0.08em", textTransform: "uppercase", color: pendingDecision === "keep" ? "var(--accent)" : "var(--muted)", marginBottom: 12 }}>
            {pendingDecision === "keep" ? "What made it click?" : "What put you off?"}
          </div>

          {showChips && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
              {(pendingDecision === "keep" ? keepReasons : skipReasons).map((reason) => (
                <button
                  key={reason}
                  onClick={() => toggleReason(reason)}
                  style={{
                    padding: "8px 14px", borderRadius: 20,
                    border: selectedReasons.includes(reason) ? "1.5px solid var(--accent)" : "1.5px solid var(--line)",
                    background: selectedReasons.includes(reason) ? "rgba(184,84,80,0.08)" : "var(--bg)",
                    fontSize: 13, fontFamily: "var(--sans)",
                    color: selectedReasons.includes(reason) ? "var(--accent)" : "var(--ink)",
                    cursor: "pointer", fontWeight: 500,
                  }}
                >
                  {reason}
                </button>
              ))}
            </div>
          )}

          <textarea
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            placeholder={showChips ? "Anything specific? (optional)" : pendingDecision === "keep" ? "Tell me what made it stand out..." : "Tell me why — what felt off?"}
            rows={2}
            style={{
              width: "100%", border: "1px solid var(--line)", borderRadius: 8,
              padding: "10px 12px", fontFamily: "var(--serif)", fontSize: 14,
              color: "var(--ink)", background: "var(--bg)", resize: "none",
              boxSizing: "border-box", marginBottom: 12,
            }}
          />

          <button
            onClick={() => onFeedback(selectedReasons, freeText)}
            disabled={!canSubmit}
            style={{
              width: "100%", padding: "12px", borderRadius: 10, border: "none",
              background: canSubmit ? "var(--accent)" : "var(--line)",
              color: "#fff", fontSize: 14, fontFamily: "var(--sans)",
              cursor: canSubmit ? "pointer" : "default", fontWeight: 600,
            }}
          >
            Done →
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

export default function Home() {
  const [stage, setStage] = useState<Stage>(1);
  const { appState, loadAppState, initAppState, addContact, updateContact, addDebrief, updateLearnings } = useAppState();

  // Stage 1
  const [messages, setMessages] = useState<Message[]>([]);
  const [userInput, setUserInput] = useState("");
  const [s1Streaming, setS1Streaming] = useState(false);
  const [hypothesis, setHypothesis] = useState("");
  const [hypothesisVisible, setHypothesisVisible] = useState(false);
  const [hypothesisActed, setHypothesisActed] = useState(false);

  // Stage 2
  const [companies, setCompanies] = useState<Company[]>([]);
  const [cardIndex, setCardIndex] = useState(0);
  const [keptCompanies, setKeptCompanies] = useState<KeptCompany[]>([]);
  const [skippedCompanies, setSkippedCompanies] = useState<SkippedCompany[]>([]);
  const [totalCompaniesReviewed, setTotalCompaniesReviewed] = useState(0);
  const [s2Loading, setS2Loading] = useState(false);
  const [pendingDecision, setPendingDecision] = useState<"keep" | "skip" | null>(null);
  const [previouslySeenCompanies, setPreviouslySeenCompanies] = useState<string[]>([]);

  // Stage 3
  const [targetCompanies, setTargetCompanies] = useState<Company[]>([]);
  const [companyIndex, setCompanyIndex] = useState(0);
  const [suggestedPeople, setSuggestedPeople] = useState<{ knownPeople: { name: string; role: string }[]; roles: string[] } | null>(null);
  const [s3Loading, setS3Loading] = useState(false);
  const [selectedPeople, setSelectedPeople] = useState<OutreachTarget[]>([]);

  // Stage 4
  const [outreachQueue, setOutreachQueue] = useState<OutreachTarget[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [currentDraft, setCurrentDraft] = useState("");
  const [s4Streaming, setS4Streaming] = useState(false);
  const [generatingDrafts, setGeneratingDrafts] = useState(false);
  const [copied, setCopied] = useState(false);

  // Stage 6
  const [activeContact, setActiveContact] = useState<Contact | null>(null);
  const [s6ReplyInput, setS6ReplyInput] = useState("");
  const [s6Classifying, setS6Classifying] = useState(false);
  const [s6LumenMessage, setS6LumenMessage] = useState("");
  const [s6Streaming, setS6Streaming] = useState(false);
  const [s6ShowReplyInput, setS6ShowReplyInput] = useState(false);

  // Stage 7
  const [prepCard, setPrepCard] = useState<{ header: string; question: string; warning: string } | null>(null);
  const [s7Loading, setS7Loading] = useState(false);

  // Stage 8
  const [debriefStep, setDebriefStep] = useState(0);
  const [debriefAnswers, setDebriefAnswers] = useState<string[]>([]);
  const [debriefInput, setDebriefInput] = useState("");
  const [s8Streaming, setS8Streaming] = useState(false);
  const [s8LumenMessage, setS8LumenMessage] = useState("");
  const [s8Compressing, setS8Compressing] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (outreachQueue[queueIndex]) {
      setCurrentDraft(outreachQueue[queueIndex].draft);
      setCopied(false);
    }
  }, [queueIndex, outreachQueue]);

  // Mount: check localStorage before starting Stage 1
  const s1Started = useRef(false);
  useEffect(() => {
    if (s1Started.current) return;

    const stored = loadAppState();
    if (stored && stored.contacts.length > 0) {
      // Resume coaching loop
      setHypothesis(stored.hypothesis);
      const urgent = mostUrgentContact(stored.contacts);
      if (urgent) {
        setActiveContact(urgent);
        setStage(6);
      }
      return;
    }

    // No existing state — start Stage 1
    s1Started.current = true;
    const opening: Message = { role: "assistant", content: "" };
    setMessages([opening]);
    setS1Streaming(true);
    streamClaude(
      [{ role: "user", content: "Hi, I'm ready to start." }],
      STAGE_1_SYSTEM,
      (chunk) => {
        setMessages((prev) => {
          const updated = [...prev];
          updated[0] = { ...updated[0], content: updated[0].content + chunk };
          return updated;
        });
      }
    ).finally(() => setS1Streaming(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startStage2 = async (
    hyp: string,
    seen: string[] = previouslySeenCompanies,
    skipped: SkippedCompany[] = skippedCompanies
  ) => {
    setS2Loading(true);
    setCardIndex(0);
    setPendingDecision(null);
    let raw = "";
    await streamClaude(
      [{ role: "user", content: "Suggest companies." }],
      getStage2System(hyp, seen, skipped),
      (chunk) => { raw += chunk; }
    );
    setS2Loading(false);
    try {
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed: Company[] = JSON.parse(jsonMatch[0]);
        setCompanies(parsed);
        setPreviouslySeenCompanies((prev) => [...new Set([...prev, ...parsed.map((c) => c.name)])]);
      }
    } catch {
      setCompanies([{
        name: "Wix",
        stage: "Public",
        description: "Cloud-based web development platform used by millions.",
        domain: "Developer Tools",
        why_fit: "Large eng org with deep investment in infra and platform tooling.",
        website: "wix.com",
        size: "5,000+ employees",
      }]);
    }
  };

  const loadPeopleForCompany = async (company: Company, reason: string, hyp: string) => {
    setSuggestedPeople(null);
    setS3Loading(true);
    let raw = "";
    await streamClaude(
      [{ role: "user", content: `Company: ${company.name}` }],
      getStage3PeopleSystem(hyp, company.name, reason),
      (chunk) => { raw += chunk; }
    );
    setS3Loading(false);
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        setSuggestedPeople(JSON.parse(jsonMatch[0]));
      }
    } catch {
      setSuggestedPeople({ knownPeople: [], roles: ["CEO", "Founder", "Head of Product", "VP Sales", "Head of R&D"] });
    }
  };

  const startStage3 = async (targets: Company[], kept: KeptCompany[], hyp: string) => {
    setTargetCompanies(targets);
    setCompanyIndex(0);
    setSelectedPeople([]);
    setStage(3);
    const reason = kept.find((k) => k.company.name === targets[0].name)?.reason ?? "";
    await loadPeopleForCompany(targets[0], reason, hyp);
  };

  const generateDrafts = async (targets: OutreachTarget[], hyp: string) => {
    setGeneratingDrafts(true);
    setStage(4);
    const withDrafts = [...targets];
    for (let i = 0; i < withDrafts.length; i++) {
      const t = withDrafts[i];
      let d = "";
      await streamClaude(
        [{ role: "user", content: `Write to ${t.person.name ?? "a " + t.person.role} at ${t.company.name}` }],
        getStage4DraftSystem(hyp, t.person.name, t.person.role, t.company.name),
        (chunk) => { d += chunk; }
      );
      withDrafts[i] = { ...t, draft: d };
    }
    setOutreachQueue(withDrafts);
    setQueueIndex(0);
    setGeneratingDrafts(false);
  };

  const submitS1Message = async (text: string) => {
    if (!text.trim() || s1Streaming) return;
    const userMsg: Message = { role: "user", content: text };
    const newMessages = [...messages, userMsg];
    setMessages([...newMessages, { role: "assistant", content: "" }]);
    setS1Streaming(true);

    let fullResponse = "";
    let freshHypothesis = hypothesis;
    await streamClaude(newMessages, STAGE_1_SYSTEM, (chunk) => {
      fullResponse += chunk;
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          content: updated[updated.length - 1].content + chunk,
        };
        return updated;
      });
    });
    setS1Streaming(false);

    const hypothesisMatch = fullResponse.match(/\*\*Hypothesis:\*\*\s*([\s\S]+?)(?=---|$)/);
    if (hypothesisMatch) {
      freshHypothesis = hypothesisMatch[1].trim();
      setHypothesis(freshHypothesis);
      setHypothesisVisible(true);
      setHypothesisActed(false);
    }

    if (fullResponse.includes("CONFIRMED")) {
      setTimeout(() => setStage(2), 600);
      startStage2(freshHypothesis);
    }
  };

  const handleS1Submit = async () => {
    if (!userInput.trim() || s1Streaming) return;
    const text = userInput.trim();
    setUserInput("");
    await submitS1Message(text);
  };

  const handleHypothesisButton = async (text: string) => {
    setHypothesisActed(true);
    await submitS1Message(text);
  };

  const handleFeedback = (reasons: string[], freeText: string) => {
    const decision = pendingDecision;
    setPendingDecision(null);

    const currentCompany = companies[cardIndex];
    let newKept = keptCompanies;
    let newSkipped = skippedCompanies;

    if (decision === "keep") {
      const combinedReason = [...reasons, freeText].filter(Boolean).join("; ") || "Seems interesting";
      newKept = [...keptCompanies, { company: currentCompany, reason: combinedReason }];
      setKeptCompanies(newKept);
    } else {
      newSkipped = [...skippedCompanies, { company: currentCompany, reasons, freeText }];
      setSkippedCompanies(newSkipped);
    }

    setTotalCompaniesReviewed((n) => n + 1);

    const newIndex = cardIndex + 1;
    setCardIndex(newIndex);

    if (newIndex >= companies.length) {
      if (newKept.length >= 3) {
        const targets = newKept.slice(0, 3).map((k) => k.company);
        setTimeout(() => startStage3(targets, newKept, hypothesis), 800);
      } else {
        setTimeout(() => startStage2(hypothesis, previouslySeenCompanies, newSkipped), 400);
      }
    }
  };

  const handleKeep = () => setPendingDecision("keep");
  const handleSkip = () => setPendingDecision("skip");

  const handleSelectPerson = (person: SuggestedPerson) => {
    const company = targetCompanies[companyIndex];
    setSelectedPeople((prev) => {
      const exists = prev.some(
        (t) => t.person.role === person.role && t.person.name === person.name && t.company.name === company.name
      );
      if (exists) {
        return prev.filter(
          (t) => !(t.person.role === person.role && t.person.name === person.name && t.company.name === company.name)
        );
      }
      return [...prev, { company, person, draft: "", status: "pending" }];
    });
  };

  const isPersonSelected = (person: SuggestedPerson) => {
    const company = targetCompanies[companyIndex];
    return selectedPeople.some(
      (t) => t.person.role === person.role && t.person.name === person.name && t.company.name === company.name
    );
  };

  const handleNextCompany = async () => {
    const nextIdx = companyIndex + 1;
    setCompanyIndex(nextIdx);
    const company = targetCompanies[nextIdx];
    const reason = keptCompanies.find((k) => k.company.name === company.name)?.reason ?? "";
    await loadPeopleForCompany(company, reason, hypothesis);
  };

  const handleBuildList = () => {
    generateDrafts(selectedPeople, hypothesis);
  };

  const handleQueueAction = (action: "sent" | "skipped") => {
    const target = outreachQueue[queueIndex];

    if (action === "sent") {
      // Create Contact in AppState immediately — durable at the click moment
      const newContact: Contact = {
        id: crypto.randomUUID(),
        name: target.person.name ?? target.person.role,
        company: target.company.name,
        linkedinUrl: target.person.linkedinSearchUrl,
        stage: "sent",
        draftSavedAt: Date.now(),
        prepCompleted: false,
        debriefs: [],
      };

      // Initialize AppState if this is the first sent contact
      if (!appState) {
        const state = initAppState(hypothesis);
        // addContact needs the state to exist first; initAppState sets it, then we add
        setTimeout(() => addContact(newContact), 0);
        void state;
      } else {
        addContact(newContact);
      }
    }

    const updated = [...outreachQueue];
    updated[queueIndex] = { ...updated[queueIndex], draft: currentDraft, status: action };
    setOutreachQueue(updated);

    const next = queueIndex + 1;
    if (next >= outreachQueue.length) {
      setStage(5);
    } else {
      setQueueIndex(next);
    }
  };

  const handleRegenerate = async () => {
    const target = outreachQueue[queueIndex];
    setS4Streaming(true);
    setCurrentDraft("");
    await streamClaude(
      [{ role: "user", content: `Write to ${target.person.name ?? "a " + target.person.role} at ${target.company.name}` }],
      getStage4DraftSystem(hypothesis, target.person.name, target.person.role, target.company.name),
      (chunk) => setCurrentDraft((prev) => prev + chunk)
    );
    setS4Streaming(false);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(currentDraft);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ─── Stage 6 handlers ───────────────────────────────────────────────────────

  const handleS6ReplySubmit = async () => {
    if (!activeContact || !s6ReplyInput.trim()) return;
    setS6Classifying(true);

    let raw = "";
    await streamClaude(
      [{ role: "user", content: `Reply text: "${s6ReplyInput}"` }],
      getStage6SentimentSystem(),
      (chunk) => { raw += chunk; }
    );
    setS6Classifying(false);

    let sentiment: "positive" | "rejection" = "positive";
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        // neutral routes same as positive per design doc
        sentiment = parsed.sentiment === "rejection" ? "rejection" : "positive";
      }
    } catch { /* default to positive */ }

    const updatedContact: Partial<Contact> = {
      replyText: s6ReplyInput,
      replySentiment: sentiment,
      stage: "replied",
    };
    updateContact(activeContact.id, updatedContact);
    setActiveContact((prev) => prev ? { ...prev, ...updatedContact } : prev);

    // Stream Lumen's response
    setS6Streaming(true);
    setS6LumenMessage("");
    const contactWithReply = { ...activeContact, ...updatedContact } as Contact;
    const systemPrompt = sentiment === "positive"
      ? getStage6CelebrationSystem(contactWithReply, hypothesis)
      : getStage6RejectionSystem(contactWithReply);

    await streamClaude(
      [{ role: "user", content: "I got a reply." }],
      systemPrompt,
      (chunk) => setS6LumenMessage((prev) => prev + chunk)
    );
    setS6Streaming(false);
  };

  const handleMeetingScheduled = () => {
    if (!activeContact) return;
    updateContact(activeContact.id, { stage: "meeting_prep" });
    setActiveContact((prev) => prev ? { ...prev, stage: "meeting_prep" } : prev);
    loadPrepCard();
  };

  const loadPrepCard = async () => {
    if (!activeContact) return;
    setS7Loading(true);
    setStage(7);
    let raw = "";
    const contactForPrep = activeContact.stage === "meeting_prep"
      ? activeContact
      : { ...activeContact, stage: "meeting_prep" as const };
    await streamClaude(
      [{ role: "user", content: "Prepare me for this conversation." }],
      getStage7PrepSystem(contactForPrep, hypothesis, appState?.learningsSummary ?? ""),
      (chunk) => { raw += chunk; }
    );
    setS7Loading(false);
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        setPrepCard(JSON.parse(jsonMatch[0]));
      }
    } catch {
      setPrepCard({
        header: `${activeContact.name} · ${activeContact.company}`,
        question: "What does ownership actually look like day-to-day on your team?",
        warning: "Don't ask about salary or timelines. You're here to learn.",
      });
    }
  };

  const handlePrepReady = () => {
    if (!activeContact) return;
    updateContact(activeContact.id, { prepCompleted: true, stage: "debrief_pending" });
    setActiveContact((prev) => prev ? { ...prev, prepCompleted: true, stage: "debrief_pending" } : prev);
    setDebriefStep(0);
    setDebriefAnswers([]);
    setS8LumenMessage("");
    setStage(8);
  };

  // ─── Stage 8 handlers ───────────────────────────────────────────────────────

  const handleDebriefAnswer = async () => {
    if (!debriefInput.trim() || !activeContact) return;
    const answer = debriefInput.trim();
    const newAnswers = [...debriefAnswers, answer];
    setDebriefAnswers(newAnswers);
    setDebriefInput("");

    if (debriefStep < DEBRIEF_QUESTIONS.length - 1) {
      setDebriefStep((s) => s + 1);
      return;
    }

    // All 3 answers collected — synthesize
    const debrief = {
      date: Date.now(),
      surprise: newAnswers[0],
      selfLearning: newAnswers[1],
      marketLearning: newAnswers[2],
    };

    setS8Streaming(true);
    setS8LumenMessage("");
    await streamClaude(
      [{ role: "user", content: "Here's what I learned." }],
      getStage8SynthesisSystem(activeContact, debrief, hypothesis, appState?.learningsSummary ?? ""),
      (chunk) => setS8LumenMessage((prev) => prev + chunk)
    );
    setS8Streaming(false);

    // Persist debrief
    addDebrief(activeContact.id, debrief);
    setActiveContact((prev) => prev ? { ...prev, stage: "done", debriefs: [...prev.debriefs, debrief] } : prev);

    // Compress learningsSummary in background
    setS8Compressing(true);
    const existingSummary = appState?.learningsSummary ?? "";
    const compressionInput = `${existingSummary}\n\nNew debrief with ${activeContact.name} at ${activeContact.company}:\n- Surprise: ${debrief.surprise}\n- Self-learning: ${debrief.selfLearning}\n- Market learning: ${debrief.marketLearning}`;
    let compressed = "";
    await streamClaude(
      [{ role: "user", content: compressionInput }],
      getCompressionSystem(),
      (chunk) => { compressed += chunk; }
    );
    setS8Compressing(false);
    updateLearnings(compressed.trim());
  };

  const currentTarget = outreachQueue[queueIndex];
  const selectedForCurrentCompany = selectedPeople.filter(
    (t) => targetCompanies[companyIndex] && t.company.name === targetCompanies[companyIndex].name
  );

  const activeContacts = appState?.contacts.filter((c) => c.stage !== "done") ?? [];
  const showNudgeBanner = activeContacts.some(
    (c) => c.stage === "sent" && Date.now() - c.draftSavedAt > THREE_DAYS_MS
  );

  // ── Render ──

  return (
    <>
      <style>{`
        @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        textarea:focus { outline: none; }
        button:hover { opacity: 0.88; }
        .chip-btn:hover { border-color: var(--accent) !important; color: var(--accent) !important; }
      `}</style>

      <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", flexDirection: "column" }}>

        {/* Header */}
        <header style={{
          padding: "20px 32px", borderBottom: "1px solid var(--line)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: "var(--bg)", position: "sticky", top: 0, zIndex: 10,
        }}>
          <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 22, color: "var(--accent)", fontWeight: 400, letterSpacing: "-0.01em" }}>
            lumen
          </div>
          {stage <= 5 ? (
            <StageIndicator stage={stage} />
          ) : activeContacts.length > 0 ? (
            <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--muted)", letterSpacing: "0.08em" }}>
              {activeContacts.length} in progress
            </div>
          ) : null}
        </header>

        {/* 3-day nudge banner */}
        {showNudgeBanner && stage >= 6 && (
          <div style={{
            background: "rgba(193,123,123,0.08)", borderBottom: "1px solid rgba(193,123,123,0.2)",
            padding: "10px 32px", fontFamily: "var(--serif)", fontSize: 14, color: "var(--ink)",
          }}>
            Lumen has something for you — a contact is waiting for a follow-up.
          </div>
        )}

        {/* Content */}
        <div style={{ flex: 1, maxWidth: 640, width: "100%", margin: "0 auto", padding: "32px 24px 100px" }}>

          {/* ── Stage 1: Interview ── */}
          {stage === 1 && (
            <div>
              <div style={{ marginBottom: 24 }}>
                <h1 style={{ fontFamily: "var(--serif)", fontSize: 26, fontWeight: 400, margin: "0 0 6px", color: "var(--ink)" }}>
                  Let&apos;s figure out what lights you up.
                </h1>
                <p style={{ fontFamily: "var(--sans)", fontSize: 14, color: "var(--muted)", margin: 0 }}>
                  I&apos;ll ask you 5 questions. Be honest — there are no wrong answers.
                </p>
              </div>

              <div style={{ marginBottom: 16 }}>
                {messages.map((msg, i) => (
                  <ChatBubble
                    key={i}
                    message={msg}
                    isStreaming={s1Streaming && i === messages.length - 1 && msg.role === "assistant"}
                  />
                ))}
                <div ref={chatEndRef} />
              </div>

              {hypothesisVisible && !s1Streaming && (
                <div style={{ background: "var(--paper)", border: "1.5px solid var(--accent)", borderRadius: 12, padding: 20, marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontFamily: "var(--mono)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--accent)", marginBottom: 8 }}>
                    Your hypothesis
                  </div>
                  <p style={{ fontFamily: "var(--serif)", fontSize: 16, lineHeight: 1.65, color: "var(--ink)", margin: 0 }}>
                    {hypothesis}
                  </p>
                </div>
              )}

              {hypothesisVisible && !s1Streaming && !hypothesisActed && (
                <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
                  <button
                    onClick={() => handleHypothesisButton("Let's refine it")}
                    style={{ flex: 1, padding: "12px", borderRadius: 10, border: "1.5px solid var(--line)", background: "transparent", fontSize: 14, fontFamily: "var(--sans)", color: "var(--ink)", cursor: "pointer", fontWeight: 500 }}
                  >
                    Let&apos;s refine it
                  </button>
                  <button
                    onClick={() => handleHypothesisButton("Yes, this works")}
                    style={{ flex: 1, padding: "12px", borderRadius: 10, border: "none", background: "var(--accent)", fontSize: 14, fontFamily: "var(--sans)", color: "#fff", cursor: "pointer", fontWeight: 600 }}
                  >
                    Yes, this works →
                  </button>
                </div>
              )}

              {!s1Streaming && (
                <div style={{ display: "flex", gap: 10, background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 14, padding: "10px 14px", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
                  <textarea
                    ref={inputRef}
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleS1Submit(); } }}
                    placeholder="What's on your mind about the search?"
                    rows={2}
                    suppressHydrationWarning
                    style={{ flex: 1, border: "none", background: "transparent", fontFamily: "var(--serif)", fontSize: 15, color: "var(--ink)", resize: "none", lineHeight: 1.5 }}
                  />
                  <button
                    onClick={handleS1Submit}
                    disabled={!userInput.trim()}
                    style={{
                      alignSelf: "flex-end", width: 36, height: 36, borderRadius: "50%",
                      background: userInput.trim() ? "var(--accent)" : "var(--line)",
                      border: "none", cursor: userInput.trim() ? "pointer" : "default",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: "#fff", fontSize: 16, flexShrink: 0,
                    }}
                  >
                    ↑
                  </button>
                </div>
              )}

              {s1Streaming && (
                <div style={{ textAlign: "center", fontSize: 13, color: "var(--muted)", fontFamily: "var(--mono)", padding: "8px 0" }}>
                  Lumen is thinking...
                </div>
              )}
            </div>
          )}

          {/* ── Stage 2: Companies ── */}
          {stage === 2 && (
            <div>
              <div style={{ marginBottom: 28 }}>
                <h1 style={{ fontFamily: "var(--serif)", fontSize: 26, fontWeight: 400, margin: "0 0 6px" }}>
                  Companies worth talking to.
                </h1>
                <p style={{ fontFamily: "var(--sans)", fontSize: 14, color: "var(--muted)", margin: 0 }}>
                  Your reactions help Lumen find the right fit.
                </p>
              </div>

              {s2Loading || companies.length === 0 ? (
                <div style={{ textAlign: "center", padding: "60px 0", color: "var(--muted)", fontFamily: "var(--serif)", fontSize: 16 }}>
                  <div style={{ width: 24, height: 24, border: "2px solid var(--line)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 16px" }} />
                  Got it. Mapping your market...
                </div>
              ) : cardIndex < companies.length ? (
                <CompanyCard
                  key={cardIndex}
                  company={companies[cardIndex]}
                  onKeep={handleKeep}
                  onSkip={handleSkip}
                  current={cardIndex + 1}
                  total={companies.length}
                  pendingDecision={pendingDecision}
                  onFeedback={handleFeedback}
                  totalReviewed={totalCompaniesReviewed}
                />
              ) : (
                <div style={{ textAlign: "center", padding: "80px 0", animation: "fadeIn 0.4s ease" }}>
                  {keptCompanies.length >= 3 ? (
                    <>
                      <p style={{ fontFamily: "var(--serif)", fontSize: 22, lineHeight: 1.55, color: "var(--ink)", margin: "0 0 10px" }}>
                        Building your list for {keptCompanies.slice(0, 3).map((k) => k.company.name).join(", ")}.
                      </p>
                      <p style={{ fontFamily: "var(--sans)", fontSize: 15, color: "var(--muted)", margin: 0 }}>
                        Finding the right people to talk to...
                      </p>
                    </>
                  ) : (
                    <>
                      <p style={{ fontFamily: "var(--serif)", fontSize: 22, lineHeight: 1.55, color: "var(--ink)", margin: "0 0 10px" }}>
                        Finding more matches...
                      </p>
                      <p style={{ fontFamily: "var(--sans)", fontSize: 15, color: "var(--muted)", margin: 0 }}>
                        Using your feedback to narrow things down.
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Stage 3: People chips ── */}
          {stage === 3 && (
            <div>
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 12, fontFamily: "var(--mono)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 4 }}>
                  {companyIndex + 1} of {targetCompanies.length}
                </div>
                <h1 style={{ fontFamily: "var(--serif)", fontSize: 26, fontWeight: 400, margin: "0 0 6px" }}>
                  {targetCompanies[companyIndex]?.name}
                </h1>
                <p style={{ fontFamily: "var(--sans)", fontSize: 14, color: "var(--muted)", margin: "0 0 28px" }}>
                  People to talk to
                </p>
              </div>

              {s3Loading ? (
                <div style={{ textAlign: "center", padding: "60px 0", color: "var(--muted)", fontFamily: "var(--serif)", fontSize: 16 }}>
                  <div style={{ width: 24, height: 24, border: "2px solid var(--line)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 16px" }} />
                  Finding the right people...
                </div>
              ) : suggestedPeople && (
                <div style={{ animation: "fadeIn 0.3s ease" }}>
                  {suggestedPeople.knownPeople.length > 0 && (
                    <div style={{ marginBottom: 28 }}>
                      <div style={{ fontSize: 11, fontFamily: "var(--mono)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 12 }}>
                        Known People
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {suggestedPeople.knownPeople.map((p) => {
                          const person: SuggestedPerson = {
                            name: p.name,
                            role: p.role,
                            linkedinSearchUrl: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(p.name + " " + targetCompanies[companyIndex]?.name)}&origin=GLOBAL_SEARCH_HEADER`,
                            isKnown: true,
                          };
                          const selected = isPersonSelected(person);
                          return (
                            <button
                              key={p.name}
                              className="chip-btn"
                              onClick={() => handleSelectPerson(person)}
                              style={{
                                display: "inline-flex", alignItems: "center", gap: 6,
                                padding: "8px 14px", borderRadius: 20,
                                border: selected ? "1.5px solid var(--accent)" : "1.5px solid rgba(10,102,194,0.25)",
                                background: selected ? "rgba(184,84,80,0.08)" : "rgba(10,102,194,0.06)",
                                fontSize: 13, fontFamily: "var(--sans)",
                                color: selected ? "var(--accent)" : "#0a66c2",
                                cursor: "pointer", fontWeight: 500, transition: "all 0.15s",
                              }}
                            >
                              <LinkedInIcon />
                              {p.name} — {p.role}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div style={{ marginBottom: 32 }}>
                    <div style={{ fontSize: 11, fontFamily: "var(--mono)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 12 }}>
                      Search by Role
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {suggestedPeople.roles.map((role) => {
                        const person: SuggestedPerson = {
                          name: null,
                          role,
                          linkedinSearchUrl: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(role + " " + targetCompanies[companyIndex]?.name + " Israel")}&origin=GLOBAL_SEARCH_HEADER`,
                          isKnown: false,
                        };
                        const selected = isPersonSelected(person);
                        return (
                          <button
                            key={role}
                            className="chip-btn"
                            onClick={() => handleSelectPerson(person)}
                            style={{
                              display: "inline-flex", alignItems: "center", gap: 6,
                              padding: "8px 14px", borderRadius: 20,
                              border: selected ? "1.5px solid var(--accent)" : "1.5px solid var(--line)",
                              background: selected ? "rgba(184,84,80,0.08)" : "var(--bg)",
                              fontSize: 13, fontFamily: "var(--sans)",
                              color: selected ? "var(--accent)" : "var(--ink)",
                              cursor: "pointer", fontWeight: 500, transition: "all 0.15s",
                            }}
                          >
                            <LinkedInIcon />
                            {role}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {companyIndex < targetCompanies.length - 1 ? (
                    <button
                      onClick={handleNextCompany}
                      disabled={selectedForCurrentCompany.length === 0}
                      style={{
                        width: "100%", padding: "14px",
                        background: selectedForCurrentCompany.length > 0 ? "var(--accent)" : "var(--line)",
                        color: "#fff", border: "none", borderRadius: 12,
                        fontSize: 15, fontFamily: "var(--sans)", cursor: selectedForCurrentCompany.length > 0 ? "pointer" : "default",
                        fontWeight: 600,
                      }}
                    >
                      Next: {targetCompanies[companyIndex + 1]?.name} →
                    </button>
                  ) : (
                    <button
                      onClick={handleBuildList}
                      disabled={selectedPeople.length === 0}
                      style={{
                        width: "100%", padding: "14px",
                        background: selectedPeople.length > 0 ? "var(--accent)" : "var(--line)",
                        color: "#fff", border: "none", borderRadius: 12,
                        fontSize: 15, fontFamily: "var(--sans)", cursor: selectedPeople.length > 0 ? "pointer" : "default",
                        fontWeight: 600,
                      }}
                    >
                      Build my list — {selectedPeople.length} {selectedPeople.length === 1 ? "person" : "people"} →
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Stage 4: Draft queue ── */}
          {stage === 4 && generatingDrafts && (
            <div style={{ textAlign: "center", padding: "80px 0", animation: "fadeIn 0.4s ease" }}>
              <div style={{ width: 24, height: 24, border: "2px solid var(--line)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 20px" }} />
              <p style={{ fontFamily: "var(--serif)", fontSize: 20, color: "var(--ink)", margin: "0 0 8px" }}>
                Writing your messages...
              </p>
              <p style={{ fontFamily: "var(--sans)", fontSize: 14, color: "var(--muted)", margin: 0 }}>
                {outreachQueue.filter((t) => t.draft).length} of {selectedPeople.length} ready
              </p>
            </div>
          )}

          {stage === 4 && !generatingDrafts && currentTarget && (
            <div style={{ animation: "fadeIn 0.3s ease" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                <div>
                  <div style={{ fontSize: 12, fontFamily: "var(--mono)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 2 }}>
                    {currentTarget.company.name}
                  </div>
                  <h1 style={{ fontFamily: "var(--serif)", fontSize: 22, fontWeight: 400, margin: 0, color: "var(--ink)" }}>
                    {currentTarget.person.name ?? currentTarget.person.role}
                    {currentTarget.person.name && (
                      <span style={{ fontFamily: "var(--sans)", fontSize: 14, color: "var(--muted)", fontWeight: 400, marginLeft: 8 }}>
                        · {currentTarget.person.role}
                      </span>
                    )}
                  </h1>
                </div>
                <div style={{ fontSize: 13, fontFamily: "var(--mono)", color: "var(--muted)", textAlign: "right" }}>
                  {queueIndex + 1} / {outreachQueue.length}
                </div>
              </div>

              <div style={{ marginBottom: 20 }}>
                <a
                  href={currentTarget.person.linkedinSearchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "rgba(10,102,194,0.07)", border: "1.5px solid rgba(10,102,194,0.2)", borderRadius: 20, fontSize: 13, fontFamily: "var(--sans)", color: "#0a66c2", textDecoration: "none", fontWeight: 500 }}
                >
                  <LinkedInIcon />
                  {currentTarget.person.isKnown
                    ? `Find ${currentTarget.person.name} on LinkedIn →`
                    : `Search ${currentTarget.person.role} at ${currentTarget.company.name} →`}
                </a>
              </div>

              <div style={{ background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 16, padding: 28, marginBottom: 16, boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
                <textarea
                  value={currentDraft}
                  onChange={(e) => setCurrentDraft(e.target.value)}
                  style={{ width: "100%", border: "none", background: "transparent", fontFamily: "var(--serif)", fontSize: 16, lineHeight: 1.7, color: "var(--ink)", resize: "none", minHeight: 140, outline: "none", boxSizing: "border-box" }}
                  rows={6}
                  disabled={s4Streaming}
                />
                {s4Streaming && (
                  <div style={{ fontSize: 12, fontFamily: "var(--mono)", color: "var(--muted)", marginTop: 8 }}>
                    Writing...
                  </div>
                )}
              </div>

              {!s4Streaming && (
                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  <button
                    onClick={handleRegenerate}
                    style={{ padding: "12px 18px", background: "transparent", color: "var(--muted)", border: "1.5px solid var(--line)", borderRadius: 10, fontSize: 14, fontFamily: "var(--sans)", cursor: "pointer", fontWeight: 500 }}
                  >
                    Regenerate
                  </button>
                  <button
                    onClick={handleCopy}
                    style={{ padding: "12px 18px", background: copied ? "rgba(184,84,80,0.1)" : "transparent", color: copied ? "var(--accent)" : "var(--ink)", border: "1.5px solid var(--line)", borderRadius: 10, fontSize: 14, fontFamily: "var(--sans)", cursor: "pointer", fontWeight: 500 }}
                  >
                    {copied ? "Copied!" : "Copy"}
                  </button>
                  <button
                    onClick={() => handleQueueAction("skipped")}
                    style={{ padding: "12px 18px", background: "transparent", color: "var(--muted)", border: "1.5px solid var(--line)", borderRadius: 10, fontSize: 14, fontFamily: "var(--sans)", cursor: "pointer", fontWeight: 500 }}
                  >
                    Skip
                  </button>
                  <button
                    onClick={() => handleQueueAction("sent")}
                    style={{ flex: 1, padding: "12px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontFamily: "var(--sans)", cursor: "pointer", fontWeight: 600 }}
                  >
                    I sent it →
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Stage 5: Done ── */}
          {stage === 5 && (
            <div style={{ textAlign: "center", paddingTop: 60, animation: "fadeIn 0.4s ease" }}>
              <div style={{ fontSize: 48, marginBottom: 20 }}>✓</div>
              <h1 style={{ fontFamily: "var(--serif)", fontSize: 28, fontWeight: 400, marginBottom: 12 }}>
                You&apos;re done for now.
              </h1>
              <p style={{ fontFamily: "var(--serif)", fontSize: 17, color: "var(--ink-2)", lineHeight: 1.65, maxWidth: 400, margin: "0 auto 32px" }}>
                {outreachQueue.filter((t) => t.status === "sent").length} messages sent
                across {[...new Set(outreachQueue.filter((t) => t.status === "sent").map((t) => t.company.name))].length} companies.
                Lumen will check in when replies come back.
              </p>
              <button
                onClick={() => {
                  // Preserve AppState — only reset Stage 2-4 state
                  setCardIndex(0);
                  setCompanies([]);
                  setKeptCompanies([]);
                  setSkippedCompanies([]);
                  setTotalCompaniesReviewed(0);
                  setPendingDecision(null);
                  setStage(2);
                  startStage2(hypothesis, previouslySeenCompanies, []);
                }}
                style={{ padding: "14px 32px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 12, fontSize: 15, fontFamily: "var(--sans)", cursor: "pointer", fontWeight: 600 }}
              >
                Add more companies →
              </button>
            </div>
          )}

          {/* ── Stage 6: Reply tracking ── */}
          {stage === 6 && activeContact && (
            <div style={{ animation: "fadeIn 0.4s ease" }}>
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 12, fontFamily: "var(--mono)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 4 }}>
                  {activeContact.company}
                </div>
                <h1 style={{ fontFamily: "var(--serif)", fontSize: 26, fontWeight: 400, margin: "0 0 6px", color: "var(--ink)" }}>
                  {activeContact.name}
                </h1>
              </div>

              {/* Lumen's opening nudge or response */}
              {!s6LumenMessage && !s6Streaming && (
                <div style={{ background: "var(--paper)", border: "1px solid var(--line)", borderRadius: "18px 18px 18px 4px", padding: "14px 18px", marginBottom: 20, fontSize: 15, lineHeight: 1.6, fontFamily: "var(--serif)", color: "var(--ink)" }}>
                  {activeContact.stage === "sent" ? (
                    <>
                      You sent a message to {activeContact.name} at {activeContact.company}
                      {activeContact.draftSavedAt && ` — ${Math.floor((Date.now() - activeContact.draftSavedAt) / (1000 * 60 * 60 * 24))} days ago`}.
                      Did you get a reply?
                    </>
                  ) : activeContact.stage === "replied" && activeContact.replySentiment === "positive" ? (
                    <>They replied. Let&apos;s get you ready. Did you schedule a meeting?</>
                  ) : (
                    <>What happened with {activeContact.name}?</>
                  )}
                </div>
              )}

              {s6LumenMessage && (
                <div style={{ background: "var(--paper)", border: "1px solid var(--line)", borderRadius: "18px 18px 18px 4px", padding: "14px 18px", marginBottom: 20, fontSize: 15, lineHeight: 1.6, fontFamily: "var(--serif)", color: "var(--ink)" }}>
                  {renderMarkdown(s6LumenMessage)}
                  {s6Streaming && <span style={{ display: "inline-block", width: 2, height: "1em", background: "currentColor", marginLeft: 2, verticalAlign: "text-bottom", animation: "blink 1s step-end infinite" }} />}
                </div>
              )}

              {/* Action buttons — before reply is submitted */}
              {!s6LumenMessage && !s6Streaming && !s6ShowReplyInput && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <button
                    onClick={() => setS6ShowReplyInput(true)}
                    style={{ width: "100%", padding: "14px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 12, fontSize: 15, fontFamily: "var(--sans)", cursor: "pointer", fontWeight: 600 }}
                  >
                    Yes, I got a reply →
                  </button>
                  <button
                    onClick={() => {
                      // No reply — normalize silence
                      setS6LumenMessage(`Silence is normal. Most people reply within 2-5 days. If you don't hear back by ${new Date(activeContact.draftSavedAt + 7 * 24 * 60 * 60 * 1000).toLocaleDateString("en-IL", { weekday: "long", month: "short", day: "numeric" })}, one short follow-up is appropriate — and I'll help you write it.`);
                    }}
                    style={{ width: "100%", padding: "14px", background: "transparent", color: "var(--muted)", border: "1.5px solid var(--line)", borderRadius: 12, fontSize: 15, fontFamily: "var(--sans)", cursor: "pointer", fontWeight: 500 }}
                  >
                    No reply yet
                  </button>
                </div>
              )}

              {/* Reply input */}
              {s6ShowReplyInput && !s6LumenMessage && (
                <div>
                  <div style={{ fontSize: 12, fontFamily: "var(--mono)", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 10 }}>
                    Paste their reply
                  </div>
                  <textarea
                    value={s6ReplyInput}
                    onChange={(e) => setS6ReplyInput(e.target.value)}
                    placeholder="Paste what they said..."
                    rows={4}
                    style={{ width: "100%", border: "1px solid var(--line)", borderRadius: 10, padding: "12px 14px", fontFamily: "var(--serif)", fontSize: 15, color: "var(--ink)", background: "var(--paper)", resize: "none", marginBottom: 12, boxSizing: "border-box" }}
                  />
                  <button
                    onClick={handleS6ReplySubmit}
                    disabled={!s6ReplyInput.trim() || s6Classifying}
                    style={{ width: "100%", padding: "14px", background: s6ReplyInput.trim() ? "var(--accent)" : "var(--line)", color: "#fff", border: "none", borderRadius: 12, fontSize: 15, fontFamily: "var(--sans)", cursor: s6ReplyInput.trim() ? "pointer" : "default", fontWeight: 600 }}
                  >
                    {s6Classifying ? "Reading the reply..." : "Lumen, read this →"}
                  </button>
                </div>
              )}

              {/* Post-reply actions: meeting scheduled or not */}
              {s6LumenMessage && !s6Streaming && activeContact.replySentiment === "positive" && activeContact.stage === "replied" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
                  <button
                    onClick={handleMeetingScheduled}
                    style={{ width: "100%", padding: "14px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 12, fontSize: 15, fontFamily: "var(--sans)", cursor: "pointer", fontWeight: 600 }}
                  >
                    I have a meeting scheduled →
                  </button>
                  <button
                    onClick={() => {
                      // No meeting yet — update to show we're in a waiting state
                      updateContact(activeContact.id, { stage: "replied" });
                      setS6LumenMessage((prev) => prev + "\n\nNo meeting yet — that's fine. Come back when you have a date and I'll prep you.");
                    }}
                    style={{ width: "100%", padding: "14px", background: "transparent", color: "var(--muted)", border: "1.5px solid var(--line)", borderRadius: 12, fontSize: 15, fontFamily: "var(--sans)", cursor: "pointer", fontWeight: 500 }}
                  >
                    No meeting yet
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Stage 7: Meeting prep ── */}
          {stage === 7 && (
            <div style={{ animation: "fadeIn 0.4s ease" }}>
              <div style={{ marginBottom: 28 }}>
                <h1 style={{ fontFamily: "var(--serif)", fontSize: 26, fontWeight: 400, margin: "0 0 6px", color: "var(--ink)" }}>
                  Let&apos;s get you ready.
                </h1>
                <p style={{ fontFamily: "var(--sans)", fontSize: 14, color: "var(--muted)", margin: 0 }}>
                  One question. One thing to avoid. That&apos;s all you need.
                </p>
              </div>

              {s7Loading ? (
                <div style={{ textAlign: "center", padding: "60px 0", color: "var(--muted)", fontFamily: "var(--serif)", fontSize: 16 }}>
                  <div style={{ width: 24, height: 24, border: "2px solid var(--line)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 16px" }} />
                  Lumen is reading the conversation...
                </div>
              ) : prepCard ? (
                <PrepCard
                  header={prepCard.header}
                  question={prepCard.question}
                  warning={prepCard.warning}
                  onReady={handlePrepReady}
                />
              ) : null}
            </div>
          )}

          {/* ── Stage 8: Post-meeting debrief ── */}
          {stage === 8 && (
            <div style={{ animation: "fadeIn 0.4s ease" }}>
              <div style={{ marginBottom: 24 }}>
                <h1 style={{ fontFamily: "var(--serif)", fontSize: 26, fontWeight: 400, margin: "0 0 6px", color: "var(--ink)" }}>
                  How did it go?
                </h1>
                <p style={{ fontFamily: "var(--sans)", fontSize: 14, color: "var(--muted)", margin: 0 }}>
                  3 questions. Be honest — this is how your hypothesis gets smarter.
                </p>
              </div>

              {!s8LumenMessage ? (
                <div>
                  {/* Progress dots */}
                  <div style={{ display: "flex", gap: 6, marginBottom: 24 }}>
                    {DEBRIEF_QUESTIONS.map((_, i) => (
                      <div
                        key={i}
                        style={{
                          width: 8, height: 8, borderRadius: "50%",
                          background: i < debriefStep ? "var(--accent)" : i === debriefStep ? "var(--accent)" : "var(--line)",
                          opacity: i === debriefStep ? 1 : i < debriefStep ? 0.5 : 0.3,
                        }}
                      />
                    ))}
                  </div>

                  <div style={{ background: "var(--paper)", border: "1px solid var(--line)", borderRadius: "18px 18px 18px 4px", padding: "14px 18px", marginBottom: 20, fontSize: 15, lineHeight: 1.6, fontFamily: "var(--serif)", color: "var(--ink)" }}>
                    {renderMarkdown(DEBRIEF_QUESTIONS[debriefStep])}
                  </div>

                  {/* Show prior answers */}
                  {debriefAnswers.map((answer, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
                      <div style={{ maxWidth: "75%", padding: "12px 16px", borderRadius: "18px 18px 4px 18px", background: "var(--accent)", color: "#fff", fontSize: 15, lineHeight: 1.6, fontFamily: "var(--serif)" }}>
                        {answer}
                      </div>
                    </div>
                  ))}

                  <div style={{ display: "flex", gap: 10, background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 14, padding: "10px 14px", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
                    <textarea
                      value={debriefInput}
                      onChange={(e) => setDebriefInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleDebriefAnswer(); } }}
                      placeholder="Your answer..."
                      rows={2}
                      style={{ flex: 1, border: "none", background: "transparent", fontFamily: "var(--serif)", fontSize: 15, color: "var(--ink)", resize: "none", lineHeight: 1.5 }}
                    />
                    <button
                      onClick={handleDebriefAnswer}
                      disabled={!debriefInput.trim()}
                      style={{
                        alignSelf: "flex-end", width: 36, height: 36, borderRadius: "50%",
                        background: debriefInput.trim() ? "var(--accent)" : "var(--line)",
                        border: "none", cursor: debriefInput.trim() ? "pointer" : "default",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        color: "#fff", fontSize: 16, flexShrink: 0,
                      }}
                    >
                      ↑
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ background: "var(--paper)", border: "1px solid var(--line)", borderRadius: "18px 18px 18px 4px", padding: "14px 18px", marginBottom: 20, fontSize: 15, lineHeight: 1.6, fontFamily: "var(--serif)", color: "var(--ink)" }}>
                    {renderMarkdown(s8LumenMessage)}
                    {s8Streaming && <span style={{ display: "inline-block", width: 2, height: "1em", background: "currentColor", marginLeft: 2, verticalAlign: "text-bottom", animation: "blink 1s step-end infinite" }} />}
                  </div>

                  {!s8Streaming && (
                    <div style={{ marginTop: 8 }}>
                      {s8Compressing && (
                        <p style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--muted)", marginBottom: 16 }}>
                          Lumen is updating your hypothesis...
                        </p>
                      )}
                      {!s8Compressing && (
                        <button
                          onClick={() => {
                            // Find next active contact or go back to Stage 6 with a new one
                            const remaining = appState?.contacts.filter((c) => c.stage !== "done") ?? [];
                            if (remaining.length > 0) {
                              setActiveContact(remaining[0]);
                              setS6LumenMessage("");
                              setS6ShowReplyInput(false);
                              setS6ReplyInput("");
                              setStage(6);
                            } else {
                              // All contacts done — show stage 5 to add more
                              setStage(5);
                            }
                          }}
                          style={{ width: "100%", padding: "14px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 12, fontSize: 15, fontFamily: "var(--sans)", cursor: "pointer", fontWeight: 600 }}
                        >
                          {(appState?.contacts.filter((c) => c.stage !== "done").length ?? 0) > 0
                            ? "Next contact →"
                            : "Add more companies →"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </>
  );
}
