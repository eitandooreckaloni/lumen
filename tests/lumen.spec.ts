import { test, expect, type Page } from "@playwright/test";

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_COMPANIES = [
  { name: "TestCo", stage: "Series A", description: "A focused product company.", domain: "AI/ML", why_fit: "Strong user-facing mission.", website: "testco.io", size: "50–200 employees" },
  { name: "AlphaCo", stage: "Series B", description: "Analytics for underserved teams.", domain: "SaaS", why_fit: "Direct user impact at scale.", website: "alphaco.com", size: "200–500 employees" },
  { name: "BetaCo", stage: "Seed", description: "Early-stage tooling startup.", domain: "Developer Tools", why_fit: "Hands-on product scope from day one.", website: "betaco.io", size: "10–50 employees" },
  { name: "GammaCo", stage: "Public", description: "Consumer productivity platform.", domain: "Consumer", why_fit: "Massive user base, visible problems.", website: "gammaco.com", size: "1,000+ employees" },
  { name: "DeltaCo", stage: "Series C", description: "HR tech with a human face.", domain: "HR Tech", why_fit: "Emotionally resonant problem space.", website: "deltaco.io", size: "500–1,000 employees" },
];

const MOCK_PEOPLE = {
  knownPeople: [{ name: "Jane Smith", role: "Head of Product" }],
  roles: ["CEO", "VP Engineering", "Senior Product Manager"],
};

const MOCK_DRAFT =
  "I came across TestCo while exploring product roles where the user problem is visceral. I'm a junior developer drawn to early-stage products with direct impact, and I'd love to hear how you think about product strategy here. Would you be open to 15 minutes to share your experience?";

// ─── Claude mock ──────────────────────────────────────────────────────────────

async function mockClaude(page: Page) {
  await page.route("/api/claude", async (route) => {
    const { systemPrompt, messages } = await route.request().postDataJSON();

    let text: string;

    if (systemPrompt.includes("suggest 5 Israeli tech companies")) {
      text = JSON.stringify(MOCK_COMPANIES);
    } else if (systemPrompt.includes("Suggest people at")) {
      text = JSON.stringify(MOCK_PEOPLE);
    } else if (systemPrompt.includes("Draft a LinkedIn outreach message")) {
      text = MOCK_DRAFT;
    } else {
      // Stage 1 interview — key off last user message
      const lastUser = [...messages].reverse().find((m: { role: string }) => m.role === "user");
      const content: string = lastUser?.content ?? "";

      if (content === "Hi, I'm ready to start.") {
        text = "Tell me about a project that kept you up past midnight.";
      } else if (content === "Yes, this works") {
        text = "CONFIRMED ✓";
      } else if (content === "Let's refine it") {
        text = "---\n**Hypothesis:** You're drawn to early-stage roles with high user visibility.\n---\n\nDoes this feel closer?";
      } else {
        // Any other answer → produce hypothesis
        text = "---\n**Hypothesis:** You're drawn to work where the user's problem is visceral and visible. You'd thrive at an early-stage startup building tools for underserved users.\n---\n\nDoes this feel right?";
      }
    }

    await route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
      body: `data: ${JSON.stringify({ text })}\n\ndata: [DONE]\n\n`,
    });
  });
}

// ─── Navigation helpers ───────────────────────────────────────────────────────

async function waitForStreamingDone(page: Page) {
  await expect(page.locator("text=Lumen is thinking...")).not.toBeVisible({ timeout: 10_000 });
}

async function typeAndSubmit(page: Page, text: string) {
  const textarea = page.locator("textarea").first();
  await textarea.fill(text);
  await textarea.press("Enter");
  await waitForStreamingDone(page);
}

/** Drives through Stage 1 up to hypothesis buttons showing */
async function goToHypothesis(page: Page) {
  await mockClaude(page);
  await page.goto("/");
  await expect(page.locator("text=Tell me about a project")).toBeVisible();
  await typeAndSubmit(page, "I built a job board and worked on it all night.");
  await expect(page.locator("text=Your hypothesis")).toBeVisible();
  await expect(page.locator("button", { hasText: "Yes, this works" })).toBeVisible();
}

/** Drives through to Stage 2 with companies loaded */
async function goToStage2(page: Page) {
  await goToHypothesis(page);
  await page.locator("button", { hasText: "Yes, this works" }).click();
  await waitForStreamingDone(page);
  await expect(page.locator("h1", { hasText: "Companies worth talking to" })).toBeVisible();
  // Wait for first company card to appear (use counter to avoid ambiguous text match)
  await expect(page.locator("text=1/5")).toBeVisible();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe("Stage 1: Interview", () => {
  test("loads and shows first question", async ({ page }) => {
    await mockClaude(page);
    await page.goto("/");
    await expect(page.locator("text=Tell me about a project")).toBeVisible();
    await expect(page.locator("h1", { hasText: "Let's figure out what lights you up" })).toBeVisible();
  });

  test("hypothesis buttons appear after hypothesis is shown", async ({ page }) => {
    await goToHypothesis(page);
    await expect(page.locator("button", { hasText: "Yes, this works" })).toBeVisible();
    await expect(page.locator("button", { hasText: "Let's refine it" })).toBeVisible();
  });

  test('"Yes, this works" advances to Stage 2', async ({ page }) => {
    await goToHypothesis(page);
    await page.locator("button", { hasText: "Yes, this works" }).click();
    await waitForStreamingDone(page);
    await expect(page.locator("h1", { hasText: "Companies worth talking to" })).toBeVisible();
  });

  test('"Let\'s refine it" triggers refinement and buttons reappear', async ({ page }) => {
    await goToHypothesis(page);
    await page.locator("button", { hasText: "Let's refine it" }).click();
    await waitForStreamingDone(page);

    // After refinement: a hypothesis should be visible and buttons should reappear
    await expect(page.locator("text=Your hypothesis")).toBeVisible();
    await expect(page.locator("button", { hasText: "Yes, this works" })).toBeVisible();
    await expect(page.locator("button", { hasText: "Let's refine it" })).toBeVisible();
  });

  test("free text input still works as fallback", async ({ page }) => {
    await mockClaude(page);
    await page.goto("/");
    await expect(page.locator("text=Tell me about a project")).toBeVisible();

    const textarea = page.locator("textarea").first();
    await textarea.fill("I built a job board and worked on it all night.");
    await textarea.press("Enter");
    await waitForStreamingDone(page);

    await expect(page.locator("text=Your hypothesis")).toBeVisible();
  });
});

test.describe("Stage 2: Companies", () => {
  test('shows "Seems interesting" and "Not so interesting" buttons', async ({ page }) => {
    await goToStage2(page);
    await expect(page.locator("button", { hasText: "Seems interesting" })).toBeVisible();
    await expect(page.locator("button", { hasText: "Not so interesting" })).toBeVisible();
    // Old labels should NOT be present
    await expect(page.locator("button", { hasText: "Keep" })).not.toBeVisible();
    await expect(page.locator("button", { hasText: "Skip" })).not.toBeVisible();
  });

  test("company card shows website and size", async ({ page }) => {
    await goToStage2(page);
    await expect(page.locator("text=testco.io")).toBeVisible();
    await expect(page.locator("text=50–200 employees")).toBeVisible();
  });

  test("subtitle no longer says 'Keep at least 3'", async ({ page }) => {
    await goToStage2(page);
    await expect(page.locator("text=Keep at least 3")).not.toBeVisible();
    await expect(page.locator("text=Your reactions help Lumen find the right fit")).toBeVisible();
  });

  test('"Not so interesting" shows free text only on first card (no chips)', async ({ page }) => {
    await goToStage2(page);
    await page.locator("button", { hasText: "Not so interesting" }).click();

    // Free text should be present
    await expect(page.locator("textarea").nth(0)).toBeVisible();

    // Preset chips should NOT be visible yet (totalReviewed = 0 < 5)
    await expect(page.locator("button", { hasText: "Wrong domain" })).not.toBeVisible();
    await expect(page.locator("button", { hasText: "Not interesting" })).not.toBeVisible();

    // "Done →" should be disabled (no input yet)
    const doneBtn = page.locator("button", { hasText: "Done" });
    await expect(doneBtn).toBeDisabled();
  });

  test('"Done →" becomes enabled after typing feedback', async ({ page }) => {
    await goToStage2(page);
    await page.locator("button", { hasText: "Not so interesting" }).click();

    // Type feedback in the textarea (second textarea — first is the chat input that's now hidden)
    const feedbackArea = page.locator("textarea").last();
    await feedbackArea.fill("Not the right domain for me");

    const doneBtn = page.locator("button", { hasText: "Done" });
    await expect(doneBtn).toBeEnabled();
  });

  test('"Done →" advances to next card', async ({ page }) => {
    await goToStage2(page);
    await page.locator("button", { hasText: "Not so interesting" }).click();

    const feedbackArea = page.locator("textarea").last();
    await feedbackArea.fill("Not the right domain");
    await page.locator("button", { hasText: "Done" }).click();

    // Should show card 2
    await expect(page.locator("text=2/5")).toBeVisible();
  });

  test("rejecting all companies auto-loads more (no dead-end)", async ({ page }) => {
    await goToStage2(page);

    // Reject all 5 companies
    for (let i = 0; i < 5; i++) {
      await page.locator("button", { hasText: "Not so interesting" }).click();
      const feedbackArea = page.locator("textarea").last();
      await feedbackArea.fill("Not a fit");
      await page.locator("button", { hasText: "Done" }).click();
    }

    // Should see loading state or "Finding more matches" — NOT "You skipped everything"
    await expect(page.locator("text=You skipped everything")).not.toBeVisible();
    const hasLoadMore = await page.locator("text=Finding more matches").isVisible().catch(() => false);
    const hasSpinner = await page.locator("text=Mapping your market").isVisible().catch(() => false);
    expect(hasLoadMore || hasSpinner).toBe(true);
  });

  test("chips appear on card 6+ (after 5 reviewed)", async ({ page }) => {
    await goToStage2(page);

    // Reject first 5 cards to trigger auto-load of batch 2
    for (let i = 0; i < 5; i++) {
      await page.locator("button", { hasText: "Not so interesting" }).click();
      const feedbackArea = page.locator("textarea").last();
      await feedbackArea.fill("Not a fit");
      await page.locator("button", { hasText: "Done" }).click();
    }

    // Wait for new batch to load (counter resets to 1/5)
    await expect(page.locator("text=1/5")).toBeVisible({ timeout: 12_000 });

    // Now on card 6 (totalReviewed = 5) — chips should appear
    await page.locator("button", { hasText: "Not so interesting" }).click();
    await expect(page.locator("button", { hasText: "Wrong domain" })).toBeVisible();
    await expect(page.locator("button", { hasText: "Not interesting" })).toBeVisible();
  });

  test('"Seems interesting" shows feedback prompt', async ({ page }) => {
    await goToStage2(page);
    await page.locator("button", { hasText: "Seems interesting" }).click();
    await expect(page.locator("text=What made it click?")).toBeVisible();
    const doneBtn = page.locator("button", { hasText: "Done" });
    await expect(doneBtn).toBeDisabled();
  });
});
