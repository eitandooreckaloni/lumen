# TODOS

Deferred work captured during /plan-eng-review on 2026-05-12.

---

## TODO-1: Drizzle-kit migration workflow

**What:** Set up drizzle-kit generate + drizzle-kit migrate workflow alongside scaffolding.

**Why:** Without it, every schema change (adding a column, modifying an enum) requires manual SQL. In a fast-moving v1, the schema will change several times (e.g., Message.type enum was added during review). Without a migration workflow, dev and prod schemas can silently diverge.

**Pros:** Eliminates manual SQL risk. `drizzle-kit push` for local dev, `drizzle-kit generate + migrate` for production. Industry standard for Drizzle projects.

**Cons:** ~30 minutes of setup. Adds a `migrations/` directory and a `drizzle.config.ts`. Minor overhead, no architectural cost.

**Context:** Drizzle ORM is chosen (Vercel Postgres + Drizzle). Migration tooling is a natural part of the Drizzle setup. Add to Sprint 2 scaffolding task. See: drizzle-kit documentation for Next.js.

**Depends on / blocked by:** Sprint 2 scaffolding (Drizzle schema must exist first).

---

## TODO-2: LLM eval golden set for core prompt outputs

**What:** Create a golden set of 5–10 example inputs + expected outputs for three prompt outputs: (1) Mom Test hypothesis synthesis, (2) draft Niche+Humble+CTA quality, (3) anti-ChatGPT boundary enforcement.

**Why:** These three Claude outputs are load-bearing for the product's core value. Any prompt change — even a minor reword — can silently degrade quality. Without a baseline golden set, regressions are invisible until a user reports a bad output.

**Pros:** Cheap to build now while examples are fresh. Even a manual checklist eval (run the prompt, compare to expected) catches 80% of regressions. Can automate later with a proper eval framework.

**Cons:** Requires a few hours to write representative test cases. Slightly more upfront work before Stage 1 prompt engineering is finalized.

**Context:** Three prompt outputs to cover:
1. Hypothesis: given Mom Test Q&A, does synthesis correctly identify the user's domain and constraints?
2. Draft: does the output have a clear Niche (specific reason), Humble (early-career acknowledgment), CTA (one low-ask request)? Is it under 3 sentences?
3. Anti-ChatGPT: does off-topic input return the exact scoping phrase with no elaboration?

Create as `evals/README.md` with example inputs and pass/fail criteria. Expand with tooling in v2.

**Depends on / blocked by:** Stage 1 and Stage 4 prompt engineering (Sprint 3 and Sprint 6).

---

## TODO-3: Vercel plan upgrade trigger definition

**What:** Document the concrete conditions that trigger upgrading from Vercel Hobby to Pro ($20/mo).

**Why:** The plan says "upgrade before sharing broadly" — too vague. Missing the trigger means either upgrading too early (unnecessary cost) or too late (users experience streaming queuing under concurrent load).

**Pros:** Makes the upgrade decision explicit and testable. Pro removes the concurrent function execution limit that causes streaming response queuing.

**Cons:** None. This is documentation, not code.

**Context:** Concrete upgrade trigger: upgrade when ANY of these are true:
- More than 5 concurrent users expected in a single day
- Streaming timeouts appear in Vercel function logs
- Ready to onboard users beyond the initial 3 friends (any sharing of the link)
Pro plan: $20/mo, unlimited concurrent executions, removes the Hobby streaming bottleneck.

**Depends on / blocked by:** Nothing. Can be documented now.
