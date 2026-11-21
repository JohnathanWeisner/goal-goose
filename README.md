# 🪿 Goal Goose

A kawaii 3D goose that lives on top of every web page. Tell it your goal; it watches what you're **actually** doing — not just which site you're on. Drift off track and it stares, warns, honks, and (once its manager signs off) **eats the distraction** and puts you back where you were working.

> Site blockers ban YouTube. The goose watches what you're doing: a 3Blue1Brown linear algebra lecture is fine, a cat compilation gets eaten.

**Built at the Gemini 4 NYC Hackathon (Nov 21, 2026). All code in this repo was written during the event.**

🎬 **Demo video (59 s):** see the latest [release](../../releases) — `goal-goose-demo.mp4`

<p align="center"><img src="docs/goose-concept.jpg" width="640" alt="Goose concept art (generated with Nano Banana)"></p>

## How it works

| Step | Model | Job |
|---|---|---|
| **Plan** | `gemini-4-neon` | Reads your goal once per session: what counts as on/off track, and a "home base" page. |
| **Gate** | `gemini-decision-1` (Decisions API) | Every page change: a calibrated on-task probability from a screenshot + URL + title. Clear answers stop here. |
| **Judge** | `gemini-4-hydrogen` | Looks closely when the gate is unsure; writes the goose's in-character warnings. |
| **Manager** | `gemini-decision-1` → `gemini-4-neon` | Reviews every eat *before* it happens: eat / warn / leave, *would this lose the user's work?*, *is the return page on-goal?* (one Decision 1 call). Neon decides when Decision 1's confidence < 0.7. Never eats a page you're typing on. |
| **Voice** | `gemini-3.8-flash-tts` | The goose's out-of-character deep movie-trailer voice ("Distraction. Consumed."). |
| Concept art | Nano Banana 2.1 | Generated the goose design (dev time only). |

Escalation: stare → warning (Hydrogen line + deep voice) → **Manager review** → honk, eat the video → switch back to your open on-goal tab (or the planned home page). The eaten tab becomes a page showing your goal.

### Real run (from the extension's log, goal: *"Study linear algebra for my midterm"*)

| Event | Result |
|---|---|
| Neon plan | home base: Khan Academy Linear Algebra; on/off-track definitions |
| 3Blue1Brown *Eigenvectors and eigenvalues* (YouTube) | **on track**, Decision 1 p = 0.96 (while loading: gate unsure p = 0.42 → Hydrogen: on track) |
| *You Can't Stop Laughing At These Cats* (YouTube) | **off track** ×3, p = 0.04–0.05, ~2 s per check |
| Manager | **eat** in 1.5 s · loses work 4% · return page on-goal 94% |
| Result | cat tab eaten, switched back to the open lecture tab |
| Manager overruling the goose | on our local demo-recorder page, the goose wanted to eat it; Neon (as manager): *"Leave this … tab alone because it is a utility tool rather than a distraction."* |

## The goose
Original rigged three.js model: bone skeleton + skinned neck, spring-driven animation (every joint is a damped spring, actions cross-fade, expressions change behind a blink), anime look (toon ramp + ink outlines via `OutlineEffect`). Interactions: cursor tracking, petting, click/double-click/annoyed, drag & drop, idle behaviours (nap, preen, peck, sneeze…), typing nods, focus-streak dance.

## Run it
```bash
pnpm install
node build.mjs            # dev build into dist/ (auto-reloads in Chrome on rebuild)
node build.mjs --release  # store build: no dev key, no dev test bridge
```
Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → `dist/`. Click the goose icon, paste a Gemini API key, set a goal, Start.

- `dist/preview.html` — the goose on its own, with a button per action/mood.
- `pnpm test-anim` — animation stress test (every action/mood back-to-back; checks the rig never breaks).

**Privacy:** while a session is running, screenshots of the active tab (with the goose painted out) are sent to the Gemini API to judge them. Nothing is stored except a short local log.

## Known limitations
- Each check takes ~2–4 s end to end (screenshot + network + model).
- No formal evaluation set yet (goose vs. blocklist vs. title-only on syllabus-derived pages) — next step.

## License
MIT
