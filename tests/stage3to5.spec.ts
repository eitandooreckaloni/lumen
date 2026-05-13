import { test, expect, type Page } from "@playwright/test";

const MOCK_COMPANIES = [
  { name: "TestCo", stage: "Series A", description: "A focused product company.", domain: "AI/ML", why_fit: "Strong user-facing mission.", website: "testco.io", size: "50–200 employees" },
  { name: "AlphaCo", stage: "Series B", description: "Analytics for underserved teams.", domain: "SaaS", why_fit: "Direct user impact at scale.", website: "alphaco.com", size: "200–500 employees" },
  { name: "BetaCo", stage: "Seed", description: "Early-stage tooling startup.", domain: "Developer Tools", why_fit: "Hands-on product scope from day one.", website: "betaco.io", size: "10–50 employees" },
];
const MOCK_PEOPLE = {
  knownPeople: [{ name: "Jane Smith", role: "Head of Product" }],
  roles: ["CEO", "VP Engineering", "Senior Product Manager"],
};
const MOCK_DRAFT = "I came across TestCo while exploring product roles where the user problem is visceral. I'm a junior developer drawn to early-stage products with direct impact, and I'd love to hear how you think about product strategy here. Would you be open to 15 minutes?";

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
      const lastUser = [...messages].reverse().find((m: { role: string }) => m.role === "user");
      const content: string = lastUser?.content ?? "";
      if (content === "Hi, I'm ready to start.") text = "Tell me about a project.";
      else if (content === "Yes, this works") text = "CONFIRMED ✓";
      else text = "---\n**Hypothesis:** You love user-facing work at early-stage companies.\n---\n\nDoes this feel right?";
    }
    await route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
      body: `data: ${JSON.stringify({ text })}\n\ndata: [DONE]\n\n`,
    });
  });
}

async function goToStage3(page: Page) {
  await mockClaude(page);
  await page.goto("/");
  await expect(page.locator("text=Tell me about a project")).toBeVisible({ timeout: 10000 });
  const t = page.locator("textarea").first();
  await t.fill("I built things"); await t.press("Enter");
  await expect(page.locator("text=Your hypothesis")).toBeVisible({ timeout: 10000 });
  await page.locator("button", { hasText: "Yes, this works" }).click();
  await expect(page.locator("text=1/3")).toBeVisible({ timeout: 15000 });
  // Keep all 3 quickly
  for (let i = 0; i < 3; i++) {
    await page.locator("button", { hasText: "Seems interesting" }).click();
    await page.locator("textarea").last().fill("Great!");
    await page.locator("button", { hasText: "Done" }).click();
    if (i < 2) await expect(page.locator(`text=${i+2}/3`)).toBeVisible({ timeout: 8000 });
  }
  await expect(page.locator("text=People to talk to")).toBeVisible({ timeout: 15000 });
}

test.describe("Stage 3: People", () => {
  test("shows known people and role chips", async ({ page }) => {
    await goToStage3(page);
    await expect(page.locator("button", { hasText: /Jane Smith/ })).toBeVisible();
    await expect(page.locator("button", { hasText: "CEO" })).toBeVisible();
    await expect(page.locator("button", { hasText: "VP Engineering" })).toBeVisible();
  });

  test("Next button disabled until person selected", async ({ page }) => {
    await goToStage3(page);
    await expect(page.locator("button", { hasText: /Next:/ })).toBeDisabled();
    await page.locator("button", { hasText: /Jane Smith/ }).click();
    await expect(page.locator("button", { hasText: /Next:/ })).toBeEnabled();
  });

  test("company counter shows 1 of 3", async ({ page }) => {
    await goToStage3(page);
    await expect(page.locator("text=1 of 3")).toBeVisible();
  });

  test("can navigate to company 2", async ({ page }) => {
    await goToStage3(page);
    await page.locator("button", { hasText: /Jane Smith/ }).click();
    await page.locator("button", { hasText: /Next:/ }).click();
    await expect(page.locator("text=2 of 3")).toBeVisible({ timeout: 10000 });
  });

  test("Build my list shown on last company", async ({ page }) => {
    await goToStage3(page);
    await page.locator("button", { hasText: /Jane Smith/ }).click();
    await page.locator("button", { hasText: /Next:/ }).click();
    await expect(page.locator("text=2 of 3")).toBeVisible({ timeout: 10000 });
    await page.locator("button", { hasText: "CEO" }).click();
    await page.locator("button", { hasText: /Next:/ }).click();
    await expect(page.locator("text=3 of 3")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("button", { hasText: /Build my list/ })).toBeVisible();
  });
});

test.describe("Stage 4: Draft", () => {
  async function goToStage4(page: Page) {
    await goToStage3(page);
    await page.locator("button", { hasText: /Jane Smith/ }).click();
    await page.locator("button", { hasText: /Next:/ }).click();
    await expect(page.locator("text=2 of 3")).toBeVisible({ timeout: 10000 });
    await page.locator("button", { hasText: "CEO" }).click();
    await page.locator("button", { hasText: /Next:/ }).click();
    await expect(page.locator("text=3 of 3")).toBeVisible({ timeout: 10000 });
    await page.locator("button", { hasText: "VP Engineering" }).click();
    await page.locator("button", { hasText: /Build my list/ }).click();
    await expect(page.locator("button", { hasText: "I sent it" })).toBeVisible({ timeout: 20000 });
  }

  test("shows draft with editable textarea", async ({ page }) => {
    await goToStage4(page);
    const draftArea = page.locator("textarea").last();
    await expect(draftArea).toBeEnabled();
    const val = await draftArea.inputValue();
    expect(val.length).toBeGreaterThan(10);
  });

  test("shows Regenerate, Copy, Skip, and I sent it buttons", async ({ page }) => {
    await goToStage4(page);
    await expect(page.locator("button", { hasText: "Regenerate" })).toBeVisible();
    await expect(page.locator("button", { hasText: "Copy" })).toBeVisible();
    await expect(page.locator("button", { hasText: "Skip" })).toBeVisible();
    await expect(page.locator("button", { hasText: "I sent it" })).toBeVisible();
  });

  test("counter shows 1/N", async ({ page }) => {
    await goToStage4(page);
    await expect(page.locator("text=1 / 3")).toBeVisible();
  });

  test("Skip advances to next draft", async ({ page }) => {
    await goToStage4(page);
    await page.locator("button", { hasText: "Skip" }).click();
    await expect(page.locator("text=2 / 3")).toBeVisible({ timeout: 5000 });
  });

  test("I sent it advances to next draft", async ({ page }) => {
    await goToStage4(page);
    await page.locator("button", { hasText: "I sent it" }).click();
    await expect(page.locator("text=2 / 3")).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Stage 5: Done", () => {
  async function goToStage5(page: Page) {
    await goToStage3(page);
    await page.locator("button", { hasText: /Jane Smith/ }).click();
    await page.locator("button", { hasText: /Next:/ }).click();
    await expect(page.locator("text=2 of 3")).toBeVisible({ timeout: 10000 });
    await page.locator("button", { hasText: "CEO" }).click();
    await page.locator("button", { hasText: /Next:/ }).click();
    await expect(page.locator("text=3 of 3")).toBeVisible({ timeout: 10000 });
    await page.locator("button", { hasText: "VP Engineering" }).click();
    await page.locator("button", { hasText: /Build my list/ }).click();
    await expect(page.locator("button", { hasText: "I sent it" })).toBeVisible({ timeout: 20000 });
    // Send all 3
    for (let i = 0; i < 3; i++) {
      await expect(page.locator("button", { hasText: "I sent it" })).toBeVisible({ timeout: 5000 });
      await page.locator("button", { hasText: "I sent it" }).click();
    }
    await expect(page.locator("text=You're done for now")).toBeVisible({ timeout: 8000 });
  }

  test("shows done screen with count", async ({ page }) => {
    await goToStage5(page);
    await expect(page.locator("text=You're done for now")).toBeVisible();
    await expect(page.locator("text=messages sent")).toBeVisible();
  });

  test("Add more companies button is present", async ({ page }) => {
    await goToStage5(page);
    await expect(page.locator("button", { hasText: "Add more companies" })).toBeVisible();
  });

  test("Add more companies resets to Stage 2", async ({ page }) => {
    await goToStage5(page);
    await page.locator("button", { hasText: "Add more companies" }).click();
    await expect(page.locator("h1", { hasText: "Companies worth talking to" })).toBeVisible({ timeout: 15000 });
  });
});
