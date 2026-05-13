"use client";

import { useState, useRef, useEffect } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

type Stage = 1 | 2 | 3 | 4 | 5;

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Company {
  name: string;
  stage: string;
  description: string;
  domain: string;
  why_fit: string;
  website?: string;
  size?: string;
}

interface KeptCompany {
  company: Company;
  reason: string;
}

interface SkippedCompany {
  company: Company;
  reasons: string[];
  freeText: string;
}

interface SuggestedPerson {
  name: string | null;
  role: string;
  linkedinSearchUrl: string;
  isKnown: boolean;
}

interface OutreachTarget {
  company: Company;
  person: SuggestedPerson;
  draft: string;
  status: "pending" | "sent" | "skipped";
}

// ─── Prompts ─────────────────────────────────────────────────────────────────

const STAGE_1_SYSTEM = `You are Lumen, a sharp and warm networking coach for Israeli junior developers entering the job market for the first time.

Your job: run a Mom Test-style behavioral interview to understand what they actually care about.

Rules:
- Ask exactly 5 questions, one at a time. Never ask two questions in the same message.
- After each answer, acknowledge briefly (one sentence max) then ask the next question.
- No follow-up questions, no tangents.
- After the 5th answer is given, synthesize a hypothesis.

Start with this question:
1. "What's something you've worked on or learned about lately that really interests you — a topic, a problem, something you keep coming back to?"

After they answer Q1, read their response to detect experience level:
- If they mention specific projects, work, internships, or concrete technical work → use the **experienced path**
- If they mention topics, interests, things they've been reading, or have no clear projects → use the **junior/exploring path**

**Experienced path** (Q2–Q5):
2. "When you're deep in that kind of work, what does it actually look like? What are you doing?"
3. "What kind of work or tasks do you find yourself avoiding, even when you know you should do them?"
4. "Tell me about a project or experience where something clicked — what made it work?"
5. "What have you been working on or learning on your own time?"

**Junior/exploring path** (Q2–Q5):
2. "When you're in that mode — learning, reading, exploring — what does it actually look like?"
3. "What kind of topics or activities feel draining or boring to you, even when you try?"
4. "Tell me about something you learned that really clicked for you. What made it stick?"
5. "How do you spend your time when there's no assignment or deadline driving you?"

After the user answers the 5th question, write the hypothesis using this EXACT format:

---
**Hypothesis:** [2-3 sentences: what they seem drawn to, what to avoid, and what kind of role/company fits]
---

Then ask: "Does this feel right?"

When the user confirms (says yes, sounds right, exactly, confirmed, etc.), respond with exactly this text and nothing else:
CONFIRMED ✓

Tone: direct, warm, like a sharp friend — not corporate, not a therapist.
If asked about anything outside job search and networking, respond: "I'm scoped to the networking work. Happy to come back to that whenever."`;

const getStage2System = (
  hypothesis: string,
  previousCompanies: string[] = [],
  skipped: SkippedCompany[] = []
) => {
  const previousSection =
    previousCompanies.length > 0
      ? `\nPreviously shown companies: ${previousCompanies.join(", ")}.\nPrioritize NEW companies not on this list. Only re-suggest one if there is a meaningfully different reason given the updated context — if so, add a note in why_fit explaining why it still belongs.\n`
      : "";

  const skippedSection =
    skipped.length > 0
      ? `\nThe user passed on these companies. Use their feedback to suggest BETTER-FITTING alternatives:\n${skipped
          .map((s) => {
            const reasons = [...s.reasons, s.freeText].filter(Boolean).join(", ");
            return `- ${s.company.name}: ${reasons || "not a fit"}`;
          })
          .join("\n")}\n`
      : "";

  return `You are Lumen. Based on this hypothesis, suggest 5 Israeli tech companies that would be a strong fit.

Hypothesis: ${hypothesis}
${previousSection}${skippedSection}
Return ONLY a valid JSON array — no other text, no markdown code fences:
[
  {
    "name": "company name",
    "stage": "Series B",
    "description": "one sentence: what they do",
    "domain": "AI/ML",
    "why_fit": "one specific sentence: why this fits the hypothesis — not generic",
    "website": "company.com",
    "size": "50–200 employees"
  }
]

Only suggest Israeli companies. Mix of sizes (seed to post-IPO). Be specific in why_fit. Always include website and size.`;
};

const getStage3PeopleSystem = (hypothesis: string, company: string, keepReason: string) =>
  `You are Lumen. Suggest people at ${company} for a junior Israeli developer to reach out to.

Hypothesis: ${hypothesis}
Why they kept this company: ${keepReason}

Return ONLY a valid JSON object — no markdown, no extra text:
{
  "knownPeople": [
    { "name": "Full Name", "role": "Their Title" }
  ],
  "roles": ["CEO", "Founder", "Head of Product", "VP Sales", "Head of R&D"]
}

Rules:
- knownPeople: up to 3 real named people who actually work or worked at ${company}. Only include people you are confident exist. Use empty array if unsure.
- roles: 4-6 role titles that match the hypothesis
- Prioritize Israel-based or Israel-connected people
- Avoid HR, recruiters, and generic management titles`;

const getStage4DraftSystem = (
  hypothesis: string,
  personName: string | null,
  personRole: string,
  companyName: string
) =>
  `You are Lumen. Draft a LinkedIn outreach message for a junior Israeli developer.

Target: ${personName ? personName : "a " + personRole} at ${companyName}
User hypothesis: ${hypothesis}

The message must be exactly 3 sentences:
1. Niche: One specific reason this person/company matters given the hypothesis. Not generic.
2. Humble: Acknowledge early-career status and genuine curiosity. Not asking for a job.
3. CTA: One specific low-ask. "15 minutes to ask you about X." Never vague.

Output ONLY the message. No labels, no preamble. Just the 3 sentences.`;

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
  const parts = text.split("**");
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i}>{part}</strong> : <span key={i}>{part}</span>
  );
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

export default function Home() {
  const [stage, setStage] = useState<Stage>(1);

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

  // Stage 1 opening message
  const s1Started = useRef(false);
  useEffect(() => {
    if (s1Started.current) return;
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
  }, []);

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

  // Shared submission logic for Stage 1 chat
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
      setHypothesisActed(false); // Show buttons for new/refined hypothesis
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
        // Lumen keeps going — auto-load another batch using accumulated feedback
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

  const currentTarget = outreachQueue[queueIndex];
  const selectedForCurrentCompany = selectedPeople.filter(
    (t) => targetCompanies[companyIndex] && t.company.name === targetCompanies[companyIndex].name
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
          <StageIndicator stage={stage} />
        </header>

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

              {/* Hypothesis action buttons */}
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

                  {/* Known people */}
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

                  {/* Search by role */}
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

                  {/* Navigation */}
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

          {/* ── Stage 4: CRM queue ── */}
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
              {/* Progress */}
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

              {/* LinkedIn link */}
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

              {/* Draft */}
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
                <>
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
                </>
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

        </div>
      </div>
    </>
  );
}
