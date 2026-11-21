# 🪿 Goal Goose

A 3D AI goose that lives on top of every web page. Tell it your goal; it watches what you're **actually** doing, not just which site you're on. Drift off track and it stares, warns, honks, then **eats the distraction** and marches you back to your goal.

> Site blockers ban YouTube. The goose watches what you're doing: a linear algebra lecture is fine, a cat video gets eaten.

Built at the **Gemini 4 NYC Hackathon** (Nov 21, 2026). All code in this repo was written during the event.

## How it works
| Step | Model | Job |
|---|---|---|
| Gate | `gemini-decision-1` (Decisions API) | Calibrated on-task probability from a screenshot + URL + title in ~200 ms. Clear answers stop here. |
| Judge | `gemini-4-hydrogen` | Looks closely at pages the gate is unsure about; writes the goose's in-character lines. |
| Planner | `gemini-4-neon` | Understands the goal; judges excuses *(in progress)*. |
| Voice | `gemini-3.8-flash-tts` | The goose's voice *(in progress)*. |

Escalation: stare → warn → honk + eat the video → redirect to your last on-goal page.

## Run it
```bash
pnpm install
node build.mjs          # or: node build.mjs --watch
```
Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → select `dist/`. Click the goose icon, paste your Gemini API key, set a goal, Start.

**Privacy:** screenshots of the active tab are sent to the Gemini API only while a session is running; nothing is stored except a short local log.

## Evaluation
*(in progress)* Goose vs. a site blocklist vs. a title-only model call, on goals and pages taken from real course syllabi.

## License
MIT
