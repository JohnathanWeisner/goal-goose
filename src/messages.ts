// Messages between the background worker and the on-page goose.
export type ToContent =
  | { type: "idle" }
  | { type: "thinking" }
  | { type: "welcomeBack"; text: string }
  | { type: "rects" } // reply: where the goose + bubble are, so they can be masked out of screenshots
  | { type: "happy" }
  | { type: "angry"; level: number; line: string; why?: string; manager?: string }
  | { type: "pageState" }; // reply: { editing: boolean }

export type ToBackground =
  | { type: "eaten" }
  | { type: "recheck" }
  | { type: "start" }
  | { type: "voice"; kind: "warn" | "eat" | "idle"; test?: boolean }
  | { type: "devStart"; goal: string } // dev builds only, from 127.0.0.1 test pages
  | { type: "devStop" }
  | { type: "devLog" }; // reply: { text, audio } (base64 WAV) or null
