// Messages between the background worker and the on-page goose.
export type ToContent =
  | { type: "idle" }
  | { type: "thinking" }
  | { type: "hide" }
  | { type: "show" }
  | { type: "happy" }
  | { type: "angry"; level: number; line: string; why?: string };

export type ToBackground = { type: "eaten" } | { type: "recheck" };
