// Decides whether the current page serves the user's goal.
// Step 1: Decision 1 (fast, calibrated). Step 2: Hydrogen only when Decision 1 is unsure.
import { GATE, GOOSE, MODELS } from "./config";
import { decide, generate } from "./gemini";

export type Page = { url: string; title: string; screenshot?: string /* base64 JPEG */ };

export type Verdict = {
  onTask: boolean;
  p: number; // probability the page is on-task
  confidence: number;
  source: "decision" | "judge";
  reason?: string;
  ms: number;
};

// What the planner (Neon) worked out about the goal at session start.
export type GoalPlan = { home_url: string; on_track: string; off_track: string };

let currentPlan: GoalPlan | undefined;
export const setPlan = (p?: GoalPlan) => (currentPlan = p);

const pageText = (goal: string, page: Page) =>
  `User's goal: ${goal}\n` +
  (currentPlan ? `On track means: ${currentPlan.on_track}\nOff track means: ${currentPlan.off_track}\n` : "") +
  `Current page URL: ${page.url}\nCurrent page title: ${page.title}`;

// Neon reads the goal once per session: what counts as on/off track, and where "back on track" is.
export async function planGoal(apiKey: string, goal: string): Promise<GoalPlan> {
  const out = await generate(
    apiKey,
    MODELS.planner,
    [
      {
        text:
          `A user started a focus session with this goal: "${goal}".\n` +
          "1. home_url: the single best real web page to send them back to when they drift (a full https URL to a " +
          "site that directly serves this goal, e.g. the main tool or learning resource; never a search results page).\n" +
          "2. on_track: one sentence describing what kinds of pages and content count as working on this goal.\n" +
          "3. off_track: one sentence describing what counts as a distraction for this goal, including anything the goal says to avoid.",
      },
    ],
    {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          home_url: { type: "STRING" },
          on_track: { type: "STRING" },
          off_track: { type: "STRING" },
        },
        required: ["home_url", "on_track", "off_track"],
      },
    },
  );
  const plan = JSON.parse(out.text) as GoalPlan;
  if (!/^https:\/\//.test(plan.home_url)) plan.home_url = "";
  return plan;
}

export async function judgePage(apiKey: string, goal: string, page: Page): Promise<Verdict> {
  const t0 = Date.now();
  const input: any[] = [];
  if (page.screenshot) input.push({ type: "image", data: page.screenshot, mime_type: "image/jpeg" });
  input.push({ type: "text", text: pageText(goal, page) });

  const res = await decide(apiKey, MODELS.gate, input, {
    on_task: {
      type: "noul",
      instructions:
        "Does what the user is looking at on this page directly help them make progress on their stated goal? " +
        "Judge the actual content shown (e.g. a lecture video on the goal's topic counts), not just the website.",
    },
  });
  const a = res.answers.on_task;
  const p = a.noul;
  const confidence = a.confidence;

  if (confidence >= GATE.minConfidence && (p >= GATE.onTaskAbove || p <= GATE.offTaskBelow)) {
    return { onTask: p >= GATE.onTaskAbove, p, confidence, source: "decision", ms: Date.now() - t0 };
  }

  // Unsure: ask Hydrogen to look closely.
  const parts: any[] = [];
  if (page.screenshot) parts.push({ inlineData: { mimeType: "image/jpeg", data: page.screenshot } });
  parts.push({
    text:
      pageText(goal, page) +
      "\nLook at the screenshot. Is the user currently doing something that directly helps with their goal?",
  });
  const out = await generate(apiKey, MODELS.judge, parts, {
    responseMimeType: "application/json",
    responseSchema: {
      type: "OBJECT",
      properties: { on_task: { type: "BOOLEAN" }, reason: { type: "STRING" } },
      required: ["on_task", "reason"],
    },
  });
  const parsed = JSON.parse(out.text || "{}");
  return {
    onTask: !!parsed.on_task,
    p,
    confidence,
    source: "judge",
    reason: parsed.reason,
    ms: Date.now() - t0,
  };
}

export async function gooseLine(apiKey: string, goal: string, page: Page, level: number): Promise<string> {
  const mood = ["", "suspicious", "annoyed, giving a final warning", "furious, about to eat the distraction"][level] ?? "";
  const out = await generate(
    apiKey,
    MODELS.judge,
    [
      {
        text:
          `${pageText(goal, page)}\nThe user drifted off their goal. You are ${mood}. ` +
          "Say one line to them about what they're doing instead of their goal. Reference the page specifically.",
      },
    ],
    {}, // no maxOutputTokens: thinking tokens count toward it and can leave the reply empty
    GOOSE.persona,
  );
  return out.text.replace(/^"|"$/g, "");
}
