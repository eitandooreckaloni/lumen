import { test, expect, type Page } from "@playwright/test";

// ─── Mock data ─────────────────────────────────────────────────────────────────

const HYPOTHESIS = "You love user-facing work at early-stage companies.";

const MOCK_CONTACT = {
  id: "test-contact-1",
  name: "Jane Smith",
  company: "TestCo",
  linkedinUrl: "https://linkedin.com/in/janesmith",
  stage: "sent",
  draftSavedAt: Date.now(),
  prepCompleted: false,
  debriefs: [],
};

const MOCK_PREP_CARD = {
  header: "Jane Smith · TestCo",
  question: "What does real ownership look like day-to-day on your team?",
  warning: "Don't pitch yourself or ask about salary.",
};

function makeLumenState(contacts: object[], overrides: object = {}) {
  return {
    schemaVersion: 1,
    hypothesis: HYPOTHESIS,
    learningsSummary: "",
    contacts,
    ...overrides,
  };
}

// ─── Claude mock ────────────────────────────────────────────────────────────────

async function mockClaude(page: Page, sentiment: "positive" | "rejection" = "positive") {
  await page.route("/api/claude", async (route) => {
    const { systemPrompt } = await route.request().postDataJSON();
    let text: string;

    if (systemPrompt.includes("Classify this LinkedIn reply")) {
      text = JSON.stringify({ sentiment, summary: sentiment === "positive" ? "They want to chat." : "Not interested." });
    } else if (systemPrompt.includes("first reply on LinkedIn")) {
      text = "This is the moment most people don't believe will happen. It just did. Let's get you ready for this.";
    } else if (systemPrompt.includes("rejection or no-response")) {
      text = "This happens. It tells you nothing about the next message.";
    } else if (systemPrompt.includes("Prepare a junior developer for a conversation with")) {
      text = JSON.stringify(MOCK_PREP_CARD);
    } else if (systemPrompt.includes("Synthesize a post-meeting debrief")) {
      text = "The most important insight: engineers own the full product loop here.";
    } else if (systemPrompt.includes("Compress the following learnings")) {
      text = "TestCo: engineers own full product loop, no PM layer. Confirms product ownership desire.";
    } else {
      text = "Tell me about a project.";
    }

    await route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
      body: `data: ${JSON.stringify({ text })}\n\ndata: [DONE]\n\n`,
    });
  });
}

// ─── State injection ────────────────────────────────────────────────────────────

async function injectState(page: Page, state: object) {
  await page.addInitScript((s) => {
    localStorage.setItem("lumenState", JSON.stringify(s));
  }, state);
}

// ─── Navigation helpers ─────────────────────────────────────────────────────────

async function goToStage6(page: Page, contactOverrides: object = {}) {
  const contact = { ...MOCK_CONTACT, ...contactOverrides };
  await injectState(page, makeLumenState([contact]));
  await mockClaude(page);
  await page.goto("/");
  await expect(page.locator("h1", { hasText: "Jane Smith" })).toBeVisible({ timeout: 10_000 });
}

async function goToStage6WithRejection(page: Page) {
  const contact = { ...MOCK_CONTACT };
  await injectState(page, makeLumenState([contact]));
  await mockClaude(page, "rejection");
  await page.goto("/");
  await expect(page.locator("h1", { hasText: "Jane Smith" })).toBeVisible({ timeout: 10_000 });
}

async function submitReply(page: Page, replyText = "That sounds great! I'd love to chat next Tuesday.") {
  await page.locator("button", { hasText: "Yes, I got a reply" }).click();
  await page.locator("textarea").last().fill(replyText);
  await page.locator("button", { hasText: "Lumen, read this" }).click();
}

async function goToStage7(page: Page) {
  await goToStage6(page);
  await submitReply(page);
  await expect(page.locator("button", { hasText: "I have a meeting scheduled" })).toBeVisible({ timeout: 10_000 });
  await page.locator("button", { hasText: "I have a meeting scheduled" }).click();
  await expect(page.locator("h1", { hasText: "Let's get you ready" })).toBeVisible({ timeout: 10_000 });
}

async function goToStage8(page: Page) {
  await goToStage7(page);
  await expect(page.locator("button", { hasText: "I'm ready for this conversation" })).toBeVisible({ timeout: 15_000 });
  await page.locator("button", { hasText: "I'm ready for this conversation" }).click();
  await expect(page.locator("h1", { hasText: "How did it go?" })).toBeVisible({ timeout: 10_000 });
}

async function answerDebriefQuestion(page: Page, answer: string) {
  await page.locator("textarea").last().fill(answer);
  await page.locator("textarea").last().press("Enter");
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

test.describe("Re-entry", () => {
  test("fresh start (no localStorage) → Stage 1", async ({ page }) => {
    await mockClaude(page);
    await page.goto("/");
    await expect(page.locator("h1", { hasText: "Let's figure out what lights you up" })).toBeVisible({ timeout: 10_000 });
  });

  test("with sent contact in localStorage → Stage 6 nudge", async ({ page }) => {
    await injectState(page, makeLumenState([MOCK_CONTACT]));
    await mockClaude(page);
    await page.goto("/");
    await expect(page.locator("h1", { hasText: "Jane Smith" })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("button", { hasText: "Yes, I got a reply" })).toBeVisible();
    await expect(page.locator("button", { hasText: "No reply yet" })).toBeVisible();
  });

  test("schema mismatch → graceful reset to Stage 1", async ({ page }) => {
    await injectState(page, { schemaVersion: 0, hypothesis: "old", contacts: [MOCK_CONTACT] });
    await mockClaude(page);
    await page.goto("/");
    await expect(page.locator("h1", { hasText: "Let's figure out what lights you up" })).toBeVisible({ timeout: 10_000 });
  });

  test("header shows 'N in progress' count in Stage 6", async ({ page }) => {
    await injectState(page, makeLumenState([MOCK_CONTACT]));
    await mockClaude(page);
    await page.goto("/");
    await expect(page.locator("text=1 in progress")).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("Stage 6: Reply tracking", () => {
  test("shows contact name, company, and days-ago nudge", async ({ page }) => {
    await goToStage6(page);
    await expect(page.locator("h1", { hasText: "Jane Smith" })).toBeVisible();
    // Company shown as small monospace label above the name
    await expect(page.locator("div", { hasText: /^TestCo$/ }).first()).toBeVisible();
    // Opening nudge with days-ago text
    await expect(page.locator("text=Did you get a reply?")).toBeVisible();
  });

  test('"No reply yet" shows silence normalization message', async ({ page }) => {
    await goToStage6(page);
    await page.locator("button", { hasText: "No reply yet" }).click();
    await expect(page.locator("text=Silence is normal")).toBeVisible({ timeout: 5_000 });
  });

  test('"Yes, I got a reply" shows reply textarea', async ({ page }) => {
    await goToStage6(page);
    await page.locator("button", { hasText: "Yes, I got a reply" }).click();
    await expect(page.locator("textarea").last()).toBeVisible();
    await expect(page.locator("button", { hasText: "Lumen, read this" })).toBeVisible();
  });

  test("positive reply → celebration message + meeting buttons", async ({ page }) => {
    await goToStage6(page);
    await submitReply(page);
    await expect(page.locator("text=moment most people")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("button", { hasText: "I have a meeting scheduled" })).toBeVisible();
    await expect(page.locator("button", { hasText: "No meeting yet" })).toBeVisible();
  });

  test("rejection reply → rejection message, no meeting buttons", async ({ page }) => {
    await goToStage6WithRejection(page);
    await submitReply(page, "Thanks but not interested.");
    await expect(page.locator("text=tells you nothing about the next message")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("button", { hasText: "I have a meeting scheduled" })).not.toBeVisible();
  });

  test("3-day nudge banner shown for old contact", async ({ page }) => {
    const oldContact = {
      ...MOCK_CONTACT,
      draftSavedAt: Date.now() - 4 * 24 * 60 * 60 * 1000,
    };
    await injectState(page, makeLumenState([oldContact]));
    await mockClaude(page);
    await page.goto("/");
    await expect(page.locator("h1", { hasText: "Jane Smith" })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("text=Lumen has something for you")).toBeVisible();
  });

  test("nudge banner not shown for recent contact", async ({ page }) => {
    await goToStage6(page);
    await expect(page.locator("text=Lumen has something for you")).not.toBeVisible();
  });
});

test.describe("Stage 7: Meeting prep", () => {
  test("shows 'Let's get you ready' header after meeting scheduled", async ({ page }) => {
    await goToStage7(page);
    await expect(page.locator("h1", { hasText: "Let's get you ready" })).toBeVisible();
    await expect(page.locator("text=One question. One thing to avoid")).toBeVisible();
  });

  test("PrepCard shows header, question, and warning", async ({ page }) => {
    await goToStage7(page);
    await expect(page.locator("text=Jane Smith · TestCo")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("text=What does real ownership look like")).toBeVisible();
    await expect(page.locator("text=Don't pitch yourself")).toBeVisible();
  });

  test("PrepCard 'I'm ready' button is present", async ({ page }) => {
    await goToStage7(page);
    await expect(page.locator("button", { hasText: "I'm ready for this conversation" })).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("Stage 8: Debrief", () => {
  test("shows 'How did it go?' and Q1 after ready clicked", async ({ page }) => {
    await goToStage8(page);
    await expect(page.locator("h1", { hasText: "How did it go?" })).toBeVisible();
    await expect(page.locator("text=What surprised you")).toBeVisible();
  });

  test("Q2 is not shown until Q1 is answered", async ({ page }) => {
    await goToStage8(page);
    await expect(page.locator("text=What surprised you")).toBeVisible();
    await expect(page.locator("text=What did you learn about what")).not.toBeVisible();
  });

  test("Q2 appears after Q1 is answered", async ({ page }) => {
    await goToStage8(page);
    await answerDebriefQuestion(page, "They had no PM layer — engineers own everything.");
    await expect(page.locator("text=What did you learn about what")).toBeVisible({ timeout: 5_000 });
  });

  test("after all 3 answers, shows synthesis message and CTA", async ({ page }) => {
    await goToStage8(page);
    await answerDebriefQuestion(page, "They had no PM layer — engineers own everything.");
    await expect(page.locator("text=What did you learn about what")).toBeVisible({ timeout: 5_000 });
    await answerDebriefQuestion(page, "I realized I want product ownership, not just execution.");
    await expect(page.locator("text=What's one thing you know now")).toBeVisible({ timeout: 5_000 });
    await answerDebriefQuestion(page, "They ship weekly — much faster than I expected.");
    // Synthesis message appears
    await expect(page.locator("text=engineers own the full product loop")).toBeVisible({ timeout: 15_000 });
    // CTA appears after compression finishes
    await expect(page.locator("button", { hasText: "Add more companies" })).toBeVisible({ timeout: 10_000 });
  });

  test("'Add more companies' goes to Stage 5 when all contacts done", async ({ page }) => {
    await goToStage8(page);
    await answerDebriefQuestion(page, "They had no PM layer.");
    await answerDebriefQuestion(page, "I want product ownership.");
    await answerDebriefQuestion(page, "They ship weekly.");
    await expect(page.locator("button", { hasText: "Add more companies" })).toBeVisible({ timeout: 15_000 });
    await page.locator("button", { hasText: "Add more companies" }).click();
    await expect(page.locator("text=You're done for now")).toBeVisible({ timeout: 10_000 });
  });
});
