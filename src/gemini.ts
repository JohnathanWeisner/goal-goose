// Minimal REST client for the Gemini API (works in an MV3 service worker, no SDK bundling issues).
import { API_BASE } from "./config";

async function post<T>(path: string, apiKey: string, body: unknown, timeoutMs = 20000): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${API_BASE}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (res.ok) return (await res.json()) as T;
      const text = await res.text();
      lastErr = new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      // We've seen brief empty 404s from the API; retry those, rate limits and server errors.
      if (![404, 429, 500, 502, 503, 504].includes(res.status)) break;
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  throw lastErr;
}

// ---- Decisions API ----
export type NoulAnswer = { type: "noul"; noul: number; confidence: number };
export type DecisionInput =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mime_type: string };

export async function decide(
  apiKey: string,
  model: string,
  input: DecisionInput[],
  questions: Record<string, { type: "noul" | "choice" | "score"; instructions: string; criteria?: unknown }>,
) {
  return post<{ answers: Record<string, NoulAnswer & Record<string, any>> }>("decisions", apiKey, {
    model,
    input,
    questions,
  });
}

// ---- speech (TTS): style goes in speechMetadata so the model doesn't read it aloud ----
export async function speak(apiKey: string, model: string, text: string, style: string, voiceName: string) {
  const res = await post<any>(`models/${model}:generateContent`, apiKey, {
    contents: [{ role: "user", parts: [{ text, speechMetadata: { style } }] }],
    generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } } },
  });
  const audio = res?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData)?.inlineData;
  if (!audio) throw new Error("no audio returned");
  return audio.data as string; // base64 WAV
}

// ---- generateContent ----
export type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

export async function generate(
  apiKey: string,
  model: string,
  parts: Part[],
  generationConfig: Record<string, unknown> = {},
  systemInstruction?: string,
) {
  const res = await post<any>(`models/${model}:generateContent`, apiKey, {
    contents: [{ role: "user", parts }],
    generationConfig,
    ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
  });
  const outParts: any[] = res?.candidates?.[0]?.content?.parts ?? [];
  return {
    text: outParts.map((p) => p.text ?? "").join("").trim(),
    audio: outParts.find((p) => p.inlineData)?.inlineData as { mimeType: string; data: string } | undefined,
  };
}
