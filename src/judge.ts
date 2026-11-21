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

// ---------------------------------------------------------------- the Manager
// Reviews the goose's one destructive action (eating a page) before it happens.
// Decision 1 answers three questions in one pass; Neon decides when Decision 1 isn't confident.
export type ManagerAction = "eat" | "warn" | "leave";
export type ManagerReview = {
  action: ManagerAction;
  reason: string;
  confidence: number;
  losesWork: number; // probability eating would destroy the user's in-progress work
  destinationOk?: number; // probability the return page serves the goal
  source: "decision" | "neon" | "rule";
  ms: number;
};

export async function managerReview(
  apiKey: string,
  goal: string,
  page: Page,
  ctx: { recent: string[]; editing: boolean; destination?: { url: string; title: string } },
): Promise<ManagerReview> {
  const t0 = Date.now();
  if (ctx.editing) {
    return { action: "warn", reason: "You're typing on this page; eating it could lose your work.", confidence: 1, losesWork: 1, source: "rule", ms: 0 };
  }
  const context =
    pageText(goal, page) +
    `\nRecent goose verdicts (oldest first): ${ctx.recent.join(" | ") || "none"}` +
    `\nProposed action: the goose wants to EAT this page (replace it) and send the user back to: ` +
    (ctx.destination ? `${ctx.destination.title} (${ctx.destination.url})` : "an 'eaten' page showing their goal");
  const input: any[] = [];
  if (page.screenshot) input.push({ type: "image", data: page.screenshot, mime_type: "image/jpeg" });
  input.push({ type: "text", text: context });

  const questions: Record<string, any> = {
    action: {
      type: "choice",
      instructions:
        "You are the goose's skeptical manager. The goose's earlier verdicts may be wrong: judge the page content yourself against the goal. " +
        "Only approve eating when the page is clearly unrelated to the goal. If the topic overlaps the goal at all, choose warn or leave.",
      criteria: {
        eat: "A clear, sustained distraction unrelated to the goal; safe to remove.",
        warn: "Probably a distraction but uncertain, brief, or possibly related to the goal; a warning is enough.",
        leave: "The page plausibly serves the goal, so the goose should back off.",
        other: "Unreadable or unrelated input.",
      },
    },
    loses_work: {
      type: "noul",
      instructions:
        "Is the user in the middle of something that would be lost if this page were replaced (writing, editing a document, filling a form, checking out or paying)?",
    },
  };
  if (ctx.destination) {
    questions.destination_ok = {
      type: "noul",
      instructions: `Would the proposed return page ("${ctx.destination.title}") directly help the user with their goal?`,
    };
  }
  const res = await decide(apiKey, MODELS.gate, input, questions);
  const a = res.answers.action as any;
  const losesWork = res.answers.loses_work?.noul ?? 0;
  const destinationOk = res.answers.destination_ok?.noul;
  let action: ManagerAction = a.choice === "other" ? "warn" : a.choice;
  let reason = { eat: "Clear, sustained distraction.", warn: "Not sure enough to eat it.", leave: "This page looks related to the goal." }[action];
  let source: ManagerReview["source"] = "decision";

  if (a.confidence < 0.7) {
    // Not confident: Neon reasons it out.
    const out = await generate(
      apiKey,
      MODELS.planner,
      [...(page.screenshot ? [{ inlineData: { mimeType: "image/jpeg", data: page.screenshot } }] : []), {
        text: context + "\nYou are the goose's manager. Choose eat, warn or leave, and give a one-sentence reason addressed to the goose.",
      }],
      {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: { action: { type: "STRING", enum: ["eat", "warn", "leave"] }, reason: { type: "STRING" } },
          required: ["action", "reason"],
        },
      },
    );
    const parsed = JSON.parse(out.text || "{}");
    if (["eat", "warn", "leave"].includes(parsed.action)) action = parsed.action;
    if (parsed.reason) reason = parsed.reason;
    source = "neon";
  }
  if (action === "eat" && losesWork > 0.5) {
    action = "warn";
    reason = "It looks like you're in the middle of something; eating it could lose your work.";
  }
  return { action, reason, confidence: a.confidence, losesWork, destinationOk, source, ms: Date.now() - t0 };
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
