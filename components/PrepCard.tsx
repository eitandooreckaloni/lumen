"use client";

interface PrepCardProps {
  header: string;
  question: string;
  warning: string;
  onReady: () => void;
}

export function PrepCard({ header, question, warning, onReady }: PrepCardProps) {
  return (
    <div
      style={{
        background: "var(--paper)",
        border: "1.5px solid var(--accent)",
        borderRadius: 16,
        padding: 28,
        maxWidth: 520,
        margin: "0 auto",
      }}
    >
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 11,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--accent)",
          marginBottom: 20,
        }}
      >
        {header}
      </div>

      <div style={{ marginBottom: 20 }}>
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--muted)",
            marginBottom: 8,
          }}
        >
          Ask this
        </div>
        <p
          style={{
            fontFamily: "var(--serif)",
            fontSize: 17,
            fontWeight: 600,
            lineHeight: 1.5,
            color: "var(--ink)",
            margin: 0,
          }}
        >
          {question}
        </p>
      </div>

      <div style={{ marginBottom: 28 }}>
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--muted)",
            marginBottom: 8,
          }}
        >
          Don&apos;t
        </div>
        <p
          style={{
            fontFamily: "var(--serif)",
            fontSize: 15,
            fontStyle: "italic",
            lineHeight: 1.55,
            color: "var(--muted)",
            margin: 0,
          }}
        >
          {warning}
        </p>
      </div>

      <button
        onClick={onReady}
        style={{
          width: "100%",
          padding: "14px",
          background: "var(--accent)",
          color: "#fff",
          border: "none",
          borderRadius: 12,
          fontSize: 15,
          fontFamily: "var(--sans)",
          cursor: "pointer",
          fontWeight: 600,
        }}
      >
        I&apos;m ready for this conversation →
      </button>
    </div>
  );
}
