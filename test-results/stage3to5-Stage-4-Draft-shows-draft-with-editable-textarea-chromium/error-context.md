# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: stage3to5.spec.ts >> Stage 4: Draft >> shows draft with editable textarea
- Location: tests/stage3to5.spec.ts:111:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('text=Tell me about a project')
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for locator('text=Tell me about a project')
    3 × waiting for" http://localhost:3001/" navigation to finish...
      - navigated to "http://localhost:3001/"

```

# Page snapshot

```yaml
- generic:
  - generic [active]:
    - generic [ref=e3]:
      - generic [ref=e4]:
        - generic [ref=e5]:
          - navigation [ref=e6]:
            - button "previous" [disabled] [ref=e7]:
              - img "previous" [ref=e8]
            - generic [ref=e10]:
              - generic [ref=e11]: 1/
              - text: "1"
            - button "next" [disabled] [ref=e12]:
              - img "next" [ref=e13]
          - img
        - generic [ref=e15]:
          - link "Next.js 15.5.18 (outdated) Webpack" [ref=e16] [cursor=pointer]:
            - /url: https://nextjs.org/docs/messages/version-staleness
            - img [ref=e17]
            - generic "An outdated version detected (latest is 16.2.6), upgrade is highly recommended!" [ref=e19]: Next.js 15.5.18 (outdated)
            - generic [ref=e20]: Webpack
          - img
      - generic [ref=e21]:
        - dialog "Runtime Error" [ref=e22]:
          - generic [ref=e25]:
            - generic [ref=e26]:
              - generic [ref=e27]:
                - generic [ref=e29]: Runtime Error
                - generic [ref=e30]:
                  - button "Copy Error Info" [ref=e31] [cursor=pointer]:
                    - img [ref=e32]
                  - button "No related documentation found" [disabled] [ref=e34]:
                    - img [ref=e35]
                  - link "Learn more about enabling Node.js inspector for server code with Chrome DevTools" [ref=e37] [cursor=pointer]:
                    - /url: https://nextjs.org/docs/app/building-your-application/configuring/debugging#server-side-code
                    - img [ref=e38]
              - paragraph [ref=e47]: "ENOENT: no such file or directory, open '/Users/eitan/Documents/Documents - Eitan's MacBook Air/git-repos/lumen/.next/server/pages/_document.js'"
            - generic [ref=e50]:
              - paragraph [ref=e51]:
                - text: Call Stack
                - generic [ref=e52]: "37"
              - button "Show 37 ignore-listed frame(s)" [ref=e53] [cursor=pointer]:
                - text: Show 37 ignore-listed frame(s)
                - img [ref=e54]
          - generic [ref=e56]:
            - generic [ref=e57]: "1"
            - generic [ref=e58]: "2"
        - contentinfo [ref=e59]:
          - region "Error feedback" [ref=e60]:
            - paragraph [ref=e61]:
              - link "Was this helpful?" [ref=e62] [cursor=pointer]:
                - /url: https://nextjs.org/telemetry#error-feedback
            - button "Mark as helpful" [ref=e63] [cursor=pointer]:
              - img [ref=e64]
            - button "Mark as not helpful" [ref=e67] [cursor=pointer]:
              - img [ref=e68]
    - generic [ref=e74] [cursor=pointer]:
      - button "Open Next.js Dev Tools" [ref=e75]:
        - img [ref=e76]
      - generic [ref=e79]:
        - button "Open issues overlay" [ref=e80]:
          - generic [ref=e81]:
            - generic [ref=e82]: "0"
            - generic [ref=e83]: "1"
          - generic [ref=e84]: Issue
        - button "Collapse issues badge" [ref=e85]:
          - img [ref=e86]
  - alert [ref=e88]
```

# Test source

```ts
  1   | import { test, expect, type Page } from "@playwright/test";
  2   | 
  3   | const MOCK_COMPANIES = [
  4   |   { name: "TestCo", stage: "Series A", description: "A focused product company.", domain: "AI/ML", why_fit: "Strong user-facing mission.", website: "testco.io", size: "50–200 employees" },
  5   |   { name: "AlphaCo", stage: "Series B", description: "Analytics for underserved teams.", domain: "SaaS", why_fit: "Direct user impact at scale.", website: "alphaco.com", size: "200–500 employees" },
  6   |   { name: "BetaCo", stage: "Seed", description: "Early-stage tooling startup.", domain: "Developer Tools", why_fit: "Hands-on product scope from day one.", website: "betaco.io", size: "10–50 employees" },
  7   | ];
  8   | const MOCK_PEOPLE = {
  9   |   knownPeople: [{ name: "Jane Smith", role: "Head of Product" }],
  10  |   roles: ["CEO", "VP Engineering", "Senior Product Manager"],
  11  | };
  12  | const MOCK_DRAFT = "I came across TestCo while exploring product roles where the user problem is visceral. I'm a junior developer drawn to early-stage products with direct impact, and I'd love to hear how you think about product strategy here. Would you be open to 15 minutes?";
  13  | 
  14  | async function mockClaude(page: Page) {
  15  |   await page.route("/api/claude", async (route) => {
  16  |     const { systemPrompt, messages } = await route.request().postDataJSON();
  17  |     let text: string;
  18  |     if (systemPrompt.includes("suggest 5 Israeli tech companies")) {
  19  |       text = JSON.stringify(MOCK_COMPANIES);
  20  |     } else if (systemPrompt.includes("Suggest people at")) {
  21  |       text = JSON.stringify(MOCK_PEOPLE);
  22  |     } else if (systemPrompt.includes("Draft a LinkedIn outreach message")) {
  23  |       text = MOCK_DRAFT;
  24  |     } else {
  25  |       const lastUser = [...messages].reverse().find((m: { role: string }) => m.role === "user");
  26  |       const content: string = lastUser?.content ?? "";
  27  |       if (content === "Hi, I'm ready to start.") text = "Tell me about a project.";
  28  |       else if (content === "Yes, this works") text = "CONFIRMED ✓";
  29  |       else text = "---\n**Hypothesis:** You love user-facing work at early-stage companies.\n---\n\nDoes this feel right?";
  30  |     }
  31  |     await route.fulfill({
  32  |       status: 200,
  33  |       headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  34  |       body: `data: ${JSON.stringify({ text })}\n\ndata: [DONE]\n\n`,
  35  |     });
  36  |   });
  37  | }
  38  | 
  39  | async function goToStage3(page: Page) {
  40  |   await mockClaude(page);
  41  |   await page.goto("/");
> 42  |   await expect(page.locator("text=Tell me about a project")).toBeVisible({ timeout: 10000 });
      |                                                              ^ Error: expect(locator).toBeVisible() failed
  43  |   const t = page.locator("textarea").first();
  44  |   await t.fill("I built things"); await t.press("Enter");
  45  |   await expect(page.locator("text=Your hypothesis")).toBeVisible({ timeout: 10000 });
  46  |   await page.locator("button", { hasText: "Yes, this works" }).click();
  47  |   await expect(page.locator("text=1/3")).toBeVisible({ timeout: 15000 });
  48  |   // Keep all 3 quickly
  49  |   for (let i = 0; i < 3; i++) {
  50  |     await page.locator("button", { hasText: "Seems interesting" }).click();
  51  |     await page.locator("textarea").last().fill("Great!");
  52  |     await page.locator("button", { hasText: "Done" }).click();
  53  |     if (i < 2) await expect(page.locator(`text=${i+2}/3`)).toBeVisible({ timeout: 8000 });
  54  |   }
  55  |   await expect(page.locator("text=People to talk to")).toBeVisible({ timeout: 15000 });
  56  | }
  57  | 
  58  | test.describe("Stage 3: People", () => {
  59  |   test("shows known people and role chips", async ({ page }) => {
  60  |     await goToStage3(page);
  61  |     await expect(page.locator("button", { hasText: /Jane Smith/ })).toBeVisible();
  62  |     await expect(page.locator("button", { hasText: "CEO" })).toBeVisible();
  63  |     await expect(page.locator("button", { hasText: "VP Engineering" })).toBeVisible();
  64  |   });
  65  | 
  66  |   test("Next button disabled until person selected", async ({ page }) => {
  67  |     await goToStage3(page);
  68  |     await expect(page.locator("button", { hasText: /Next:/ })).toBeDisabled();
  69  |     await page.locator("button", { hasText: /Jane Smith/ }).click();
  70  |     await expect(page.locator("button", { hasText: /Next:/ })).toBeEnabled();
  71  |   });
  72  | 
  73  |   test("company counter shows 1 of 3", async ({ page }) => {
  74  |     await goToStage3(page);
  75  |     await expect(page.locator("text=1 of 3")).toBeVisible();
  76  |   });
  77  | 
  78  |   test("can navigate to company 2", async ({ page }) => {
  79  |     await goToStage3(page);
  80  |     await page.locator("button", { hasText: /Jane Smith/ }).click();
  81  |     await page.locator("button", { hasText: /Next:/ }).click();
  82  |     await expect(page.locator("text=2 of 3")).toBeVisible({ timeout: 10000 });
  83  |   });
  84  | 
  85  |   test("Build my list shown on last company", async ({ page }) => {
  86  |     await goToStage3(page);
  87  |     await page.locator("button", { hasText: /Jane Smith/ }).click();
  88  |     await page.locator("button", { hasText: /Next:/ }).click();
  89  |     await expect(page.locator("text=2 of 3")).toBeVisible({ timeout: 10000 });
  90  |     await page.locator("button", { hasText: "CEO" }).click();
  91  |     await page.locator("button", { hasText: /Next:/ }).click();
  92  |     await expect(page.locator("text=3 of 3")).toBeVisible({ timeout: 10000 });
  93  |     await expect(page.locator("button", { hasText: /Build my list/ })).toBeVisible();
  94  |   });
  95  | });
  96  | 
  97  | test.describe("Stage 4: Draft", () => {
  98  |   async function goToStage4(page: Page) {
  99  |     await goToStage3(page);
  100 |     await page.locator("button", { hasText: /Jane Smith/ }).click();
  101 |     await page.locator("button", { hasText: /Next:/ }).click();
  102 |     await expect(page.locator("text=2 of 3")).toBeVisible({ timeout: 10000 });
  103 |     await page.locator("button", { hasText: "CEO" }).click();
  104 |     await page.locator("button", { hasText: /Next:/ }).click();
  105 |     await expect(page.locator("text=3 of 3")).toBeVisible({ timeout: 10000 });
  106 |     await page.locator("button", { hasText: "VP Engineering" }).click();
  107 |     await page.locator("button", { hasText: /Build my list/ }).click();
  108 |     await expect(page.locator("button", { hasText: "I sent it" })).toBeVisible({ timeout: 20000 });
  109 |   }
  110 | 
  111 |   test("shows draft with editable textarea", async ({ page }) => {
  112 |     await goToStage4(page);
  113 |     const draftArea = page.locator("textarea").last();
  114 |     await expect(draftArea).toBeEnabled();
  115 |     const val = await draftArea.inputValue();
  116 |     expect(val.length).toBeGreaterThan(10);
  117 |   });
  118 | 
  119 |   test("shows Regenerate, Copy, Skip, and I sent it buttons", async ({ page }) => {
  120 |     await goToStage4(page);
  121 |     await expect(page.locator("button", { hasText: "Regenerate" })).toBeVisible();
  122 |     await expect(page.locator("button", { hasText: "Copy" })).toBeVisible();
  123 |     await expect(page.locator("button", { hasText: "Skip" })).toBeVisible();
  124 |     await expect(page.locator("button", { hasText: "I sent it" })).toBeVisible();
  125 |   });
  126 | 
  127 |   test("counter shows 1/N", async ({ page }) => {
  128 |     await goToStage4(page);
  129 |     await expect(page.locator("text=1 / 3")).toBeVisible();
  130 |   });
  131 | 
  132 |   test("Skip advances to next draft", async ({ page }) => {
  133 |     await goToStage4(page);
  134 |     await page.locator("button", { hasText: "Skip" }).click();
  135 |     await expect(page.locator("text=2 / 3")).toBeVisible({ timeout: 5000 });
  136 |   });
  137 | 
  138 |   test("I sent it advances to next draft", async ({ page }) => {
  139 |     await goToStage4(page);
  140 |     await page.locator("button", { hasText: "I sent it" }).click();
  141 |     await expect(page.locator("text=2 / 3")).toBeVisible({ timeout: 5000 });
  142 |   });
```