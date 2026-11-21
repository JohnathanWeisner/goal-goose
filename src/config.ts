// Model IDs and tunables in one place.
export const API_BASE = "https://generativelanguage.googleapis.com/v1beta"; // Decisions API needs v1beta

export const MODELS = {
  gate: "gemini-decision-1", // fast calibrated on-task / off-task check (Decisions API)
  judge: "gemini-4-hydrogen", // looks closely at uncertain pages, writes the goose's lines
  planner: "gemini-4-neon", // understands the goal, judges excuses
  tts: "gemini-3.8-flash-tts", // goose voice
} as const;

export const GOOSE = {
  name: "Goose", // TODO: give the goose its own name
  persona:
    "You are a dramatic, judgmental, secretly caring study goose who lives in the user's browser. " +
    "You speak in short, punchy lines (max 14 words), never mean-spirited, sometimes ending with HONK.",
};

// The goose's "out of character" deep voice: a tiny kawaii goose with a movie-trailer narrator voice.
export const DEEP_VOICE = {
  voice: "Charon",
  style: "extremely deep, slow, gravelly, dramatic movie-trailer narrator",
  lines: {
    warn: ["Close. The tab.", "I know what you're doing.", "This is your final warning.", "Step away. From the video."],
    eat: ["Distraction. Consumed.", "It is done.", "Delicious."],
    idle: ["I am always watching.", "Stay. Focused.", "Honk."],
  },
};
export type VoiceKind = keyof typeof DEEP_VOICE.lines;

// Decision 1 thresholds: clear answers stop here, unclear ones escalate to the judge model.
export const GATE = {
  onTaskAbove: 0.75,
  offTaskBelow: 0.25,
  minConfidence: 0.7,
};

// Escalation: consecutive off-task checks needed for each level.
export const ESCALATION = {
  stare: 1,
  warn: 2,
  eat: 3,
  recheckMs: 7000, // re-check quickly once off track so the ladder plays out in ~15s
};
