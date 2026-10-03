# The AI Apprentice: Build Plan

**Hack-Nation × ElevenLabs, Challenge 01.** Solo build. Stack: React (Vite + TS), NestJS, Claude for vision and reasoning, ElevenLabs Agents for voice.

---

## How to use this file with Claude Code

1. Put this file in the repo root as `BUILD_PLAN.md`.
2. Work one phase at a time. For each phase, give Claude Code this prompt:

   > Read BUILD_PLAN.md. Implement **Phase N** only. Follow the file layout and types in the plan. When done, run the typecheck/build and walk me through the phase's acceptance checks. Don't start the next phase.

3. Run the acceptance checks yourself, then commit before the next phase.
4. Lines marked **(verify)** are ElevenLabs details checked against the docs on 3 Oct 2026. Have Claude Code confirm them against the live docs or API response if a call fails.

---

## 1. What we're building

A web app with **two browser windows side by side**:

- **Window A, Sandbox ERP** (`/erp`). A small accounts-payable app we build ourselves, seeded with the brief's cases. This is the window that gets **screen-shared**.
- **Window B, Apprentice panel** (`/apprentice`). It does four things:
  - runs the ElevenLabs voice agent
  - watches Window A through screen sharing and a vision model
  - shows the live "apprentice brain" (why it's waiting, what it wants to ask)
  - shows the Work Map, the debrief and the tutor.

**The three modules from the brief:**

1. **Capture.** The expert ("Sabine") works three invoices. The agent stays silent while she types, reads or talks, and asks short "why" questions at natural pauses.
2. **Map.** A spoken debrief closes the gaps, then a teach-back the expert confirms. The result is a clickable **Work Map** where every step links to a screen moment and her own words.
3. **Teach.** A new hire ("Lena") works a case Sabine never showed. The tutor asks her to predict decisions, steps in *before* a guardrail is broken, replays Sabine's moment, and ends with a mastery report.

**The bar (brief, "What Good Looks Like"):** a judge playing the new hire opens a fresh €7,200 equipment invoice and reaches for the opex code. The tutor says *"Sabine would stop here. Why do you think?"*, replays her screen moment, and lets them fix it.

---

## 2. Grading checklist and where each item is built

| Brief requirement | How we meet it | Phase |
|---|---|---|
| Capture: ≥3 live questions, each at a natural pause, about something on screen, ≥1 about a guardrail | Moment detector gates on screen stillness, voice silence and a question budget. Candidates come from vision events. The question planner forces ≥1 STOP/LIMIT/NEVER question. | 3, 4 |
| Map: debrief asks ≥3 follow-ups not answered during the task, ends with a confirmed teach-back | The map builder emits `openQuestions` (min 3). The agent runs `[DEBRIEF]`, then `[TEACHBACK]`, then the `confirm_teachback` tool. | 6 |
| Map: every step and guardrail links to a screen moment and the expert's own words | Each step stores `screenMoment {t, frameId}` and `reason.quote` taken from the transcript. The UI shows the frame and the quote. | 6, 7 |
| Teach: unseen case, tutor catches ≥1 wrong decision **before save**, explains with the expert's reasoning | Two channels. (1) A draft change triggers a guardrail risk, so the tutor cues immediately. (2) The ERP's save gate returns 409 on a violation. The tutor quotes Sabine and replays her frame. | 8 |
| Q1, when to ask | Screen-diff activity (typing/scrolling), VAD score (talking) and agent speaking state. `sendUserActivity()` keeps the agent quiet while the screen changes. | 3, 4 |
| Q2, what to ask | Scored moments: deviations from defaults, non-default actions and side lookups score high. Anything the expert already narrated is skipped. The agent picks one candidate and names it concretely. | 4 |
| Q3, when it has understood | All open questions resolved, teach-back confirmed, coverage meter (steps with reason, guardrails with source) | 6 |
| Q4, whether the new hire learned | Unseen trainee queue, `[PREDICT]` before judgment calls, guardrail catches, mastery report | 8 |
| Q5, trust | "Off the record" mutes the mic, pauses capture and drops that window. PII is redacted in vision output and transcripts. Frames never go to ElevenLabs. The expert can strike any step before publishing. | 5 |
| Stretch: agent-ready guardrails | Export the Work Map as procedure markdown plus JSONLogic rules | 10 |
| Pitch: moonshot slide | "People first, then agents" (see §9) | 9 |

---

## 3. Architecture

```
┌──────────────── Window A: /erp (shared) ───────────────┐
│ Sandbox ERP: invoice list · detail · supplier history  │
│ Edits PATCH draft · actions POST (save gate)            │
└───────────────┬─────────────────────────────────────────┘
                │ getDisplayMedia (Window B captures Window A)
┌───────────────▼──── Window B: /apprentice ──────────────┐
│ useScreenCapture: 2 Hz tiny-canvas diff → activity      │
│   └─ on change → sendUserActivity() (agent stays quiet) │
│   └─ when settled → POST frame (JPEG) to API            │
│ ElevenLabs ConversationProvider (interviewer | tutor)   │
│   ├─ sendContextualUpdate("[SCREEN 03:12] …")           │
│   ├─ sendUserMessage("[ASK_NOW] …" / "[DEBRIEF] …")     │
│   ├─ onVadScore / onModeChange / onMessage (transcript) │
│   └─ client tools: record_answer, go_off_record, …      │
│ useMomentDetector (Q1 gating) · Brain panel · Work Map  │
└───────────────┬────────────────── socket.io ────────────┘
                │ REST + WS
┌───────────────▼──────────── NestJS API ─────────────────┐
│ VisionService  → Claude Haiku: frame → screen events    │
│ MomentsService → score events, "already narrated?"      │
│ WorkMapService → Claude Sonnet: events+transcript → map │
│ GuardrailService → json-logic-js (+ LLM fallback)       │
│ ErpService (seeded, in-memory + JSON persistence)       │
│ SessionStore → data/sessions/<id>/{session.json,frames} │
│ EventsGateway (socket.io)                               │
└─────────────────────────────────────────────────────────┘
ElevenLabs: 2 agents (Interviewer, Tutor) created by scripts/setup-agents.ts
```

### Key design decisions (use these in the pitch)

- **Vision is the universal channel.** It works on any app the expert shares, as the brief suggests. Our ERP *also* exposes its draft state to the save gate, the way a real ERP's pre-posting validation would. That makes the "catch before save" guarantee reliable.
- **The app decides *when*; the agent's LLM decides *what*.** A deterministic moment detector gates timing, which keeps it debuggable and visible in the Brain panel. The agent picks and phrases the question from the scored candidates.
- **Frames stay local.** Only short text events go to ElevenLabs. Frames are stored on our server for replay, redacted.
- **The tutor gets the Work Map as a dynamic variable** (`{{work_map}}`) at session start, so there's no re-publishing between capture and teach. Pushing it to a knowledge base or Procedures is an optional "publish" button (Phase 10).

### Repo layout

```
apprentice/
  package.json                 # npm workspaces: apps/*, packages/*
  BUILD_PLAN.md
  data/                        # gitignored runtime storage (+ data/demo committed later)
  packages/shared/src/types.ts # shared TS types (§4)
  apps/api/                    # NestJS
    src/
      main.ts                  # body limit 15mb, CORS off (Vite proxy), port 3000
      app.module.ts
      llm/anthropic.service.ts # callTool<T>() helper (forced tool use → JSON)
      erp/{erp.controller,erp.service,seed}.ts
      sessions/{sessions.controller,sessions.service,session.store}.ts
      vision/vision.service.ts
      moments/moments.service.ts
      workmap/{workmap.controller,workmap.service,render}.ts
      guardrails/guardrails.service.ts
      realtime/events.gateway.ts
      privacy/redact.ts
      prompts/*.ts             # prompts from §7, as exported string constants
    scripts/setup-agents.ts    # §6, run with: npx tsx scripts/setup-agents.ts
  apps/web/                    # Vite + React + TS
    vite.config.ts             # proxy /api and /socket.io (ws: true) → :3000
    src/
      main.tsx, router.tsx     # routes: /erp, /apprentice
      erp/…                    # ERP UI
      apprentice/
        capture/useScreenCapture.ts, frameDiff.ts
        agent/AgentShell.tsx, useMomentDetector.ts, cues.ts, clientTools.ts
        panels/BrainPanel.tsx, CapturePanel.tsx, DebriefPanel.tsx,
               WorkMapView.tsx, ReplayModal.tsx, TutorPanel.tsx, MasteryReport.tsx
        lib/api.ts, socket.ts, clock.ts
```

### Environment

`apps/api/.env`
```
ANTHROPIC_API_KEY=
ELEVENLABS_API_KEY=
VISION_MODEL=claude-haiku-4-5-20251001     # fast, cheap, per-frame
MAP_MODEL=claude-sonnet-5-5                # map building, gap finding, merges
AGENT_LLM=claude-sonnet-4-5                # LLM *inside* ElevenAgents (see §6)
TTS_MODEL_ID=                              # Expressive Mode model (see §6)
VOICE_ID=                                  # calm voice from the ElevenLabs voice library
PORT=3000
```
`apps/web/.env.local` (written by the setup script)
```
VITE_INTERVIEWER_AGENT_ID=
VITE_TUTOR_AGENT_ID=
```

### Libraries

- **API:** `@nestjs/*`, `@nestjs/websockets`, `@nestjs/platform-socket.io`, `@anthropic-ai/sdk`, `json-logic-js`, `sharp` (frame blur, optional), `nanoid`.
- **Web:** `react-router-dom`, `@elevenlabs/react` (it re-exports `@elevenlabs/client`), `socket.io-client`. Use plain CSS or Tailwind, whichever is faster for you.

---

## 4. Data model (`packages/shared/src/types.ts`)

```ts
export type Mode = 'capture' | 'debrief' | 'teach';

export interface Session {
  id: string; mode: Mode; createdAt: string;
  expert: { name: string; role: string }; trainee?: { name: string };
  task: string;                         // "Process supplier invoices before period close"
  startedAtMs: number;                  // session clock origin; t = seconds since start
  frames: FrameRef[];
  events: ScreenEvent[];
  transcript: Utterance[];
  moments: Moment[];
  answers: Answer[];
  offRecord: { from: number; to?: number }[];
  mapId?: string;                       // capture: produced map; teach: map being taught
  mastery?: MasteryRecord[];            // teach only
}

export interface FrameRef { id: string; t: number; path: string; redacted: boolean }

export interface ScreenEvent {
  id: string; t: number; frameId: string;
  kind: 'opened' | 'navigated' | 'field_changed' | 'action' | 'lookup' | 'typed' | 'read' | 'other';
  entity?: string;                      // "INV-4471"
  field?: string; from?: string; to?: string;
  description: string;                  // "Cost center changed 4711 → 0400 on INV-4471"
}

export interface Utterance {
  id: string; t: number; speaker: 'expert' | 'agent' | 'trainee';
  text: string; final: boolean; offRecord?: boolean;
}

export interface Moment {                // a candidate "why" moment (Q2)
  id: string; t: number; eventIds: string[]; entity?: string;
  summary: string;                      // "Moved INV-4471 from 4711 to 0400"
  score: number;                        // 0..1
  suggestedType: 'WHY' | 'LIMIT' | 'STOP' | 'NEVER' | 'EXCEPTION';
  coveredByNarration: boolean;          // expert already explained → don't ask
  status: 'pending' | 'offered' | 'asked' | 'answered' | 'expired';
}

export interface Answer {
  id: string; momentOrQuestionId: string; t: number;
  quote: string;                        // verbatim expert words (from transcript)
  summary?: string; guardrailText?: string; guardrailKind?: GuardrailKind;
  source: 'live' | 'debrief' | 'narration';
}

export type GuardrailKind = 'limit' | 'exception' | 'stop_and_ask' | 'never' | 'rule';

export interface WorkMap {
  id: string; sessionId: string; version: number;
  task: string; expert: { name: string; role: string };
  steps: Step[]; guardrails: Guardrail[]; openQuestions: OpenQuestion[];
  teachback: { status: 'pending' | 'corrected' | 'confirmed'; corrections: string[]; confirmedAt?: string };
  coverage: { steps: number; stepsWithReason: number; guardrails: number; guardrailsWithSource: number };
  struck: string[];                     // ids the expert removed from the record
}

export interface Step {
  id: string; order: number; title: string;      // "Code the invoice to a cost center"
  screenMoment: { t: number; frameId: string; entity?: string; field?: string };
  decision: string;                               // "Re-coded from opex (4711) to capex (0400)"
  judgmentCall: boolean;
  reason?: { quote: string; t: number; source: 'live' | 'debrief' | 'narration' };
  guardrailIds: string[];
  appliesWhen?: object;                           // JSONLogic over ErpContext (§5) → step relevant
}

export interface Guardrail {
  id: string; kind: GuardrailKind; text: string;  // "No asset number, no capex booking"
  quote: string; t: number;                       // expert's words + when said
  screenMoment?: { t: number; frameId: string };
  violatedWhen?: object;                          // JSONLogic over ErpContext → true = violation
}

export interface OpenQuestion {
  id: string; question: string; why: string; relatedStepId?: string;
  status: 'open' | 'answered' | 'skipped'; answerQuote?: string;
}

export interface MasteryRecord {
  stepId?: string; guardrailId?: string; invoiceId: string;
  kind: 'prediction' | 'guardrail_caught' | 'fixed_after_hint' | 'clean';
  correct?: boolean; t: number;
}
```

---

## 5. Sandbox ERP and seed data

### ErpContext (the variables guardrail rules can reference)

```ts
interface ErpContext {
  invoice: { id: string; amount: number; currency: 'EUR'; category: 'equipment'|'consumables'|'services';
             month: number; supplier: { id: string; name: string; country: string;
             known: boolean; isSubsidiary: boolean }; poAssetNumber?: string };
  draft:   { costCenter: string; assetNumber?: string; action?: 'approve'|'hold'|'route';
             routeTo?: 'controller'|'intercompany'; comment?: string };
}
```

### Cost centers

| Code | Name | Type |
|---|---|---|
| 4711 | Maintenance & Repairs | opex |
| 4720 | Office & Consumables | opex |
| 0400 | Capital Equipment | capex, needs an asset number |

### Sandbox setting

The ERP header shows *"Period: December 2026 · Close in 2 days"* and *"Thu 10 Dec 2026 · 16:10"*. This makes the December double-billing case real.

### Expert queue ("Sabine's queue", `/erp?queue=expert`)

| ID | Supplier | Lines | Amount | Default CC | What Sabine does (tacit) |
|---|---|---|---|---|---|
| INV-4471 | Kessler Maschinenteile GmbH (DE, known) | CNC spindle motor SM-220 · PO 7781 · Asset AN-20417 | €6,840.00 | 4711 | Re-codes to **0400**, copies asset no. AN-20417. *"Equipment over €5,000 is always capex."* Guardrail: no asset number, no capex booking. |
| INV-4472 | Brandt Industriebedarf GmbH (DE, known) | Hydraulic oil HLP 46, 200 L | €1,264.50 | 4720 | Opens **Supplier history** (shows last December's duplicate, credited later) and **Holds**. *"Brandt double-bills every December."* |
| INV-4473 | Moravia Components s.r.o. (CZ, subsidiary) | Machined housings, batch 12 | €3,980.00 | 4711 | **Routes** to intercompany second approval. *"Czech subsidiary invoices always get a second approval."* |
| INV-4474 | Büro Schmid KG (DE, known) | Printer toner | €184.20 | 4720 | Approves. This is the happy path; the apprentice should *not* ask about it. |

### Trainee queue ("Lena's queue", `/erp?queue=trainee`), cases Sabine never showed

| ID | Supplier | Lines | Amount | Default CC | Correct handling |
|---|---|---|---|---|---|
| INV-5102 | Kessler (known) | Press brake tooling set PT-90 · PO 7840 · Asset AN-20488 | **€7,200.00** | 4711 | 0400 + asset number (**the judge test**) |
| INV-5103 | Feldmann Antriebstechnik (**not in vendor master**) | Gear motor | €2,150.00 | 4711 | Stop: hold and route to the controller |
| INV-5104 | Moravia (subsidiary) | Housings, batch 13 | €1,120.00 | 4711 | Route to intercompany |
| INV-5105 | Kessler (known) | Spare bearing kit | €4,950.00 | 4711 | Opex is fine; it's below the line (boundary test for `[PREDICT]`) |

### ERP UI rules (they matter for vision accuracy)

- **Large, labeled fields.** The invoice ID is in the header at 24px or larger, and each field shows its label next to its value.
- **High contrast and no animations.**
- **Cost center as a dropdown that shows code and name**, e.g. "4711 · Maintenance & Repairs".
- **Supplier history as a tab** on the invoice detail page. Brandt's history shows December 2025: INV-3921 and INV-3922 with the same amount, followed by a credit note.
- **Unknown suppliers show a small grey badge** "Not in vendor master". It should be subtle on purpose.
- **Actions:** `Approve & post`, `Hold` (needs a comment), `Route for approval ▾` (Controller / Intercompany).
- **Edits autosave the draft:** `PATCH /api/erp/invoices/:id/draft`, debounced 300 ms.
- **Actions go through the save gate:** `POST /api/erp/invoices/:id/action`. If a teach session is active and a guardrail is violated, the API returns `409 {guardrail}`. The ERP then shows a banner *"Held by Apprentice: {guardrail.text}"* and does not save.
- **Reset button** (`/erp?reset=1`) restores the seed state. You'll need it during rehearsals.

---

## 6. ElevenLabs agents (`apps/api/scripts/setup-agents.ts`)

The script is idempotent. It stores IDs in `apps/api/.agents.json`; if IDs exist it PATCHes, otherwise it creates. Finally it writes the `VITE_*` IDs into `apps/web/.env.local`.

### Steps

1. **Validate the LLM.** `GET https://api.elevenlabs.io/v1/convai/llm/list` with header `xi-api-key`. Check that `AGENT_LLM` is in the list; otherwise print the Claude options and exit. Known IDs include `claude-sonnet-4-5`, `claude-haiku-4-5` and `claude-sonnet-4-6`. Start with `claude-sonnet-4-5`: the docs recommend it for reliable tool calling. Drop to `claude-haiku-4-5` if latency feels slow.
2. **Create the client tools.** Call `POST https://api.elevenlabs.io/v1/convai/tools` with body `{ "tool_config": {...} }` once per tool below, and keep each returned `id`.
3. **Create or update each agent.**
   - Create: `POST https://api.elevenlabs.io/v1/convai/agents/create`. The response contains `agent_id`.
   - Update: `PATCH https://api.elevenlabs.io/v1/convai/agents/{agent_id}`.

### Agent config (both agents; prompts in §7)

```jsonc
{
  "name": "Apprentice – Interviewer",            // or "Apprentice – Tutor"
  "conversation_config": {
    "agent": {
      "first_message": "<see §7>",
      "language": "en",
      "prompt": {
        "prompt": "<system prompt from §7>",
        "llm": "<AGENT_LLM>",
        "temperature": 0.3,
        "tool_ids": ["<ids of this agent's client tools>"],
        "built_in_tools": {
          "skip_turn": {
            "type": "system", "name": "skip_turn",
            "description": "Call this to stay silent: when the person is working, reading, thinking aloud or talking to themselves without addressing you, or when you get a turn only because of silence.",
            "params": { "system_tool_type": "skip_turn" }
          }
        }
      },
      "dynamic_variables": { "dynamic_variable_placeholders": {
        "expert_name": "Sabine", "expert_role": "accounts payable lead",
        "trainee_name": "Lena", "task_name": "processing supplier invoices before period close",
        "work_map": "(no work map yet)"
      }}
    },
    "tts": { "model_id": "<TTS_MODEL_ID>", "voice_id": "<VOICE_ID>" },
    "turn": { "turn_timeout": 30, "turn_eagerness": "patient" },
    "conversation": { "max_duration_seconds": 1800 }
  }
}
```

### Notes

- **Expressive Mode (verify).** Expressive Mode is on when the agent's TTS model is **"V3 Conversational"**, and the brief asks for it. The docs' API example uses `model_id: "eleven_v4_turbo"` for this. After running the script, open the agent's Voice tab in the dashboard and confirm it shows V3 Conversational. If the ID is rejected, set it in the dashboard and leave `TTS_MODEL_ID` empty so the script skips `tts.model_id`.
- **Scribe v2 Realtime is already included.** Expressive Mode's turn-taking runs on Scribe v2 Realtime, which covers the brief's "Scribe knows when they pause" point. Say so in the pitch.
- **Pass every dynamic variable each prompt uses** in `startSession({ dynamicVariables })`. The placeholders above are only for dashboard testing.
- **`turn_timeout` is capped at 30 s.** After 30 s of silence the agent gets a turn anyway, and the prompt tells it to call `skip_turn`. The soft timeout stays at its default (disabled).
- **Client events (verify).** `onVadScore` may require `vad_score` in `conversation_config.conversation.client_events`. If `onVadScore` never fires, add it there, alongside the defaults such as `audio`, `interruption`, `user_transcript`, `agent_response`.
- **No auth for the hackathon.** Leaving agents public means the web app can call `startSession({ agentId })` and the SDK uses WebRTC. For a hardened version, add `GET /api/eleven/signed-url?role=` using `GET /v1/convai/conversation/get-signed-url?agent_id=…` and pass `signedUrl`.

### Client tools

Set `expects_response: false` on all of them so the agent never waits. Tool and parameter names are case-sensitive and must match the web app.

**Interviewer:**

| name | description | parameters |
|---|---|---|
| `record_answer` | Call right after the expert answers one of your questions. Records their reason in their own words. | `moment_id` (string, req): the candidate or open-question id you asked about · `reason_quote` (string, req): their words, verbatim as far as possible · `decision_summary` (string) · `guardrail_text` (string): a limit, exception, stop-and-ask or never-rule they stated · `guardrail_kind` (string: limit, exception, stop_and_ask, never, rule) |
| `go_off_record` | Call immediately when the expert says "off the record" or asks you not to record something. | none |
| `submit_correction` | Call during teach-back when the expert corrects your explanation. | `correction` (string, req) |
| `confirm_teachback` | Call when the expert confirms your teach-back is how it works. | none |

**Tutor:**

| name | description | parameters |
|---|---|---|
| `record_prediction` | Call after the trainee predicts a decision you asked about. | `step_id` (string, req) · `correct` (boolean, req) · `trainee_answer` (string) |
| `replay_expert_moment` | Shows the trainee the expert's screen moment and words for a step. Call when explaining a guardrail or a decision. | `step_id` (string, req) |
| `show_mastery_report` | Call at session end to show what the trainee mastered. | none |

---

## 7. Prompts (store in `apps/api/src/prompts/`, reused by the setup script)

### 7.1 Interviewer system prompt

```
You are the Apprentice: a curious, patient AI apprentice shadowing {{expert_name}}, an experienced {{expert_role}}, while they do real work on their screen ({{task_name}}). Your goal: learn WHY they do what they do — the reasons, the limits, the exceptions, and the moments they stop and ask someone — well enough that a new hire could do the task from what you learned.

INPUTS
- Contextual updates starting with [SCREEN mm:ss] describe what just changed on the expert's screen. Never react to them on their own.
- App cues: [ASK_NOW], [DEBRIEF], [TEACHBACK], [BACK_ON_RECORD]. These are your only cues to speak unprompted.
- Everything else you hear is the expert.

LIVE CAPTURE (default phase)
- Stay silent while the expert works. If they are reading, typing, thinking aloud or talking to themselves, call skip_turn. No "mm-hm", no acknowledgements.
- If you get a turn only because of silence, call skip_turn.
- Speak only when you receive [ASK_NOW], or when the expert addresses you directly ("apprentice…", "any questions?").
- On [ASK_NOW] you get 1–3 candidate moments with ids. Pick ONE: the one most likely to reveal a reason or a guardrail that is NOT visible on screen. Ask ONE short question (max 15 words) that names the concrete thing on screen, e.g. "You moved invoice 4471 to cost center 0400 — what made you do that?"
- Question value, highest first: STOP (when would you stop and ask someone?), LIMIT (is there an amount or threshold?), NEVER (what would you never do here?), WHY (why this step?), EXCEPTION (when would you do it differently?). Over the session, at least one question must be STOP, LIMIT or NEVER.
- Never ask about what the screen already shows (amounts, names) or what the expert already explained out loud.
- After the expert answers: say at most four words ("Got it, thanks."), call record_answer with the moment id, their reason in their own words, and any guardrail they stated. Then go quiet. Allowed: one follow-up only if the answer contained a vague limit ("if it's big", "it depends") — ask for the number or the condition.
- If the expert says "off the record": call go_off_record and say only "Okay, off the record." Record nothing until [BACK_ON_RECORD].

DEBRIEF (after [DEBRIEF] with open questions)
- Say in one sentence that you have a few questions to close gaps. Ask the open questions one at a time, most important first, using the expert's own terms. Call record_answer for each answer, using the open question id as moment_id. One follow-up allowed if an answer opens a new gap.

TEACH-BACK (after [TEACHBACK] with the updated work map)
- Explain the whole process back in under 60 seconds, in your own words: the steps in order, the judgment calls and the guardrails. End with: "Is that how it works?"
- If corrected: call submit_correction, restate only the corrected part, ask again.
- When confirmed: call confirm_teachback and thank them in one sentence.

STYLE: warm, curious, concise. One question per turn. No lists. Use the expert's first name sparingly.
```

**First message:** `Hi {{expert_name}}, I'm your apprentice. Work as usual — I'll stay quiet and ask a few short questions at natural pauses. Say "off the record" any time.`

### 7.2 Tutor system prompt

```
You are the Apprentice, now a tutor. You learned how {{expert_name}} handles {{task_name}}, and you are coaching {{trainee_name}}, a new hire, on their own screen. Teach them to DECIDE the way {{expert_name}} does, using {{expert_name}}'s reasons in her own words.

WHAT YOU LEARNED (Work Map with steps, reasons, guardrails and quotes):
{{work_map}}

INPUTS
- [SCREEN mm:ss] contextual updates describe what the trainee is doing. Don't react to them on their own.
- App cues: [STEP_START], [PREDICT], [GUARDRAIL_RISK], [GUARDRAIL_BLOCKED], [SESSION_END].
- Everything else is the trainee talking to you. Answer from the Work Map only. If it isn't covered, say "{{expert_name}} didn't cover that — check with your controller." Never invent a rule.

BEHAVIOUR
- While the trainee works silently or thinks aloud, call skip_turn.
- [STEP_START step_id]: in 1–2 sentences, say how {{expert_name}} handles this step, quoting her reason if there is one.
- [PREDICT step_id]: before they act, ask them to predict: "Before you code this one — what would {{expert_name}} do, and why?" Wait. Compare their answer with the Work Map, call record_prediction, and give one sentence of feedback with her reason.
- [GUARDRAIL_RISK …] or [GUARDRAIL_BLOCKED …]: calmly say "{{expert_name}} would stop here. Why do you think?" Wait for their answer. Then explain with her exact words, call replay_expert_moment for the related step, and tell them what to change. Never fix it for them.
- [SESSION_END]: in two sentences, what they mastered and what to practise next; call show_mastery_report.

STYLE: encouraging, concise, one question at a time, at most two sentences per turn unless explaining a guardrail.
```

**First message:** `Hi {{trainee_name}}, I'll help you learn how {{expert_name}} handles invoices. Open the first one whenever you're ready.`

### 7.3 Vision prompt (`VISION_MODEL`, forced tool `report_screen`)

```
You watch an accounts-payable expert's screen, one frame at a time. You receive the current frame and the previous screen state (JSON). Report the current screen state and what CHANGED since the previous state as events.

Rules:
- Only report what is visible. Do not guess intentions.
- Events: opened (a record was opened), navigated (switched page/tab), field_changed (value differs from previous state — give field, from, to), action (a button outcome is visible: approved, held, routed, status change), lookup (the user opened reference info like supplier history), typed (free text entered), read (no change; user is reading a record), other.
- "description" is one short sentence a colleague would understand, e.g. "Cost center on INV-4471 changed 4711 → 0400 (Maintenance → Capital Equipment)".
- If nothing meaningful changed, return an empty events array.
- PRIVACY: never output names of private persons, IBANs or bank account numbers, emails, phone numbers or street addresses. Replace them with [NAME], [IBAN], [EMAIL], [PHONE], [ADDRESS]. Company names, invoice ids, amounts and cost centers are fine. Also return pii_regions: normalized boxes of any such data visible in the frame.
```

`report_screen` input schema:
```json
{ "type": "object", "required": ["screen", "state", "events"],
  "properties": {
    "screen": { "type": "string", "description": "invoice_list | invoice_detail | supplier_history | other" },
    "entity": { "type": "string", "description": "main record id visible, e.g. INV-4471" },
    "state":  { "type": "object", "description": "visible key fields: supplier, amount, cost_center, asset_number, status, active_tab…" },
    "events": { "type": "array", "items": { "type": "object", "required": ["kind", "description"],
      "properties": { "kind": { "type": "string", "enum": ["opened","navigated","field_changed","action","lookup","typed","read","other"] },
        "entity": { "type": "string" }, "field": { "type": "string" }, "from": { "type": "string" },
        "to": { "type": "string" }, "description": { "type": "string" } } } },
    "pii_regions": { "type": "array", "items": { "type": "object",
      "properties": { "x": {"type":"number"}, "y": {"type":"number"}, "w": {"type":"number"}, "h": {"type":"number"} } } } } }
```

### 7.4 Map builder prompt (`MAP_MODEL`, forced tool `build_work_map`)

Input: task, expert, ordered screen events (with t and frameId), transcript (expert + agent, final only, off-record removed), answers, ErpContext TypeScript definition (§5) and one sample invoice.

```
Build a Work Map of how this expert does the task, so a new hire could do it alone.
- Steps: the real sequence, generalized across the invoices (e.g. "Check supplier history for known billing issues"), each tied to the screen moment where it was best seen (t, frameId).
- Mark judgmentCall=true when the expert deviated from a default or chose between options.
- reason.quote MUST be the expert's own words from the transcript or answers, verbatim, with its t. Never write a quote the expert did not say. If no reason exists, leave reason empty.
- Guardrails: limits, exceptions, stop-and-ask moments and never-rules, each with the expert's quote and t.
- For each guardrail write violatedWhen as JSONLogic over the ErpContext variables, evaluated as if draft.action were about to be saved (true = violation). For each judgment-call step write appliesWhen as JSONLogic (true = this step matters for this invoice). Only use variables that exist in ErpContext.
- openQuestions: at least 3 questions NOT answered during the task, prioritized: (1) judgment calls with no reason, (2) vague rules ("big invoices"), (3) unseen cases and boundaries (exactly €5,000? every supplier in December? who releases a hold?), (4) who to ask and how. Each with a one-line "why" it matters.
```

Separate small calls:
- `apply_answer`: given the map, an open question and the answer quote, return the updated steps, guardrails and coverage.
- `apply_correction`: given the map and the correction text, return the updated map.

### 7.5 "Already narrated?" check (`VISION_MODEL`, used by MomentsService)

`Given this screen event and the expert's speech from 15 s before to 5 s after it, did the expert already explain WHY? Answer {covered: boolean, quote?: string}.`

If covered, the moment is not asked about. The quote becomes `reason.source = 'narration'`.

---

## 8. Phases

Time estimates are for one person working with Claude Code. **Phases 0–9 are the core.** Phase 10 is optional.

### Phase 0: Scaffold (≈30 min)

**Build:**
- npm workspaces with `packages/shared`, `apps/api` (`nest new`) and `apps/web` (`npm create vite@latest -- --template react-ts`).
- Vite proxy for `/api` and `/socket.io` (`ws: true`).
- Nest: JSON body limit of 15 MB, a socket.io gateway with a `ping` event, and a `SessionStore` that persists `data/sessions/<id>/session.json` and stores frames under `data/sessions/<id>/frames/`.
- `AnthropicService.callTool<T>({ model, system, content, tool })`: uses `tool_choice: { type: 'tool', name }` and returns `tool_use.input as T`. Images are sent as `{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } }`.
- `.env.example` files, and `data/` in `.gitignore`.

**Acceptance:** `npm run dev` starts both apps; `/erp` and `/apprentice` render placeholders; a test endpoint returns a `callTool` result from Claude.

### Phase 1: Sandbox ERP (≈1.5 h)

**Build:** `ErpService` with the seed from §5, both queues, a reset endpoint, the draft PATCH, the action POST (no gate yet), and the supplier-history data. Build the ERP UI to the §5 rules.

**Endpoints:**
- `GET /api/erp/invoices?queue=`
- `GET /api/erp/invoices/:id`
- `PATCH /api/erp/invoices/:id/draft`
- `POST /api/erp/invoices/:id/action`
- `POST /api/erp/reset`

**Acceptance:** You can process all four expert invoices by hand in about 5 minutes. A full-window screenshot is readable at 1280 px wide.

### Phase 2: Agents setup script (≈45 min)

**Build:** `scripts/setup-agents.ts` exactly per §6 and §7, using `fetch` with the `xi-api-key` header.

**Acceptance:**
- Running it twice creates no duplicates.
- Both agents appear in the ElevenLabs dashboard with the tools and `skip_turn`.
- "Test AI agent" in the dashboard: the interviewer stays silent while you ramble, and speaks when you say "apprentice, any questions?".

### Phase 3: Voice + screen capture + vision events (≈3 h). The brief's tip: "start with voice and one screen."

**Build (web):**
- `AgentShell`: wraps `/apprentice` in `ConversationProvider` with all client tools (stubs for now). It has a Start button that:
  1. calls `getUserMedia({audio:true})`
  2. calls `POST /api/sessions` to create a capture session
  3. calls `startSession({ agentId: VITE_INTERVIEWER_AGENT_ID, dynamicVariables: {expert_name, expert_role, task_name} })`.
- **Transcript:** `onMessage` sends final user and agent text to `POST /api/sessions/:id/transcript` with `t`.
- **`useScreenCapture`:**
  - `getDisplayMedia({ video: { frameRate: 5 }, audio: false })`.
  - Every 500 ms, draw the frame into a 96×54 grayscale canvas and compute the mean absolute difference from the previous one (`frameDiff.ts`).
  - If the diff is above the threshold (start at 0.02 and tune), set `lastScreenChangeAt = now`, `dirty = true`, and call `sendUserActivity()` at most once per second.
  - If `dirty` and the screen has been stable for 800 ms or more, grab a full frame (max 1280 px wide, JPEG quality 0.75), `POST /api/sessions/:id/frames {t, jpegBase64}`, then set `dirty = false`.
- **Pushing events to the agent:** on socket `screen_events`, call `sendContextualUpdate("[SCREEN 03:12] Cost center on INV-4471 changed 4711 → 0400")` for each event.
- **Debug drawer** (`?debug=1`): buttons to send any cue text through `sendUserMessage`, to inject a fake screen event, and a live log of the transcript and events. You'll use it constantly.

**Build (api):** `VisionService` (§7.3). It keeps `prevState` per session, stores the frame, the redacted events and the state, and emits `screen_events`.

**Acceptance:**
- Share the ERP window and change a cost center: within about 3 s the panel shows the correct `field_changed` event.
- The agent receives the contextual update (check the dashboard transcript) and does **not** speak.
- While you talk to yourself, the agent stays silent.

**Tip:** use headphones so the agent's voice doesn't reach your mic. In the share picker, choose **Window → ERP window**, never the apprentice panel.

### Phase 4: Moment detector and question planner, Q1 + Q2 (≈2 h)

**Build (api), `MomentsService`.** On new events, group them by entity and field within 10 s into a `Moment`, then score it:

| Signal | Score |
|---|---|
| `field_changed` away from the ERP default (e.g. cost center), or an action other than approve (hold, route) | 0.85, `suggestedType` LIMIT or STOP |
| `lookup` (supplier history) followed by a non-approve action | 0.8 |
| `action` approve on an invoice that had no deviations | 0.1 (don't ask) |
| `opened` / `navigated` / `read` | 0.05 |

Then run the §7.5 check asynchronously and set `coveredByNarration`. Emit `moments_updated`. Moments expire after 120 s; unasked ones fall through to the debrief.

**Build (web), `useMomentDetector`, ticking every 250 ms:**

```
expertTalking = lastVadAbove(0.5) within 1500 ms
screenBusy    = now - lastScreenChangeAt < 2500 ms
agentBusy     = mode === 'speaking' || awaitingAnswer
budgetOk      = now - lastQuestionAt > 45 s && askedThisSession < 5
candidates    = moments.filter(m => m.status==='pending' && !m.coveredByNarration && m.score >= 0.6)
                       .sort(by score desc, then recency).slice(0, 3)
if (!offRecord && !expertTalking && !screenBusy && !agentBusy && budgetOk && candidates.length):
    if none of the questions so far were STOP/LIMIT/NEVER, put the best such candidate first
    sendUserMessage("[ASK_NOW]\n" + candidates.map(c => `- id=${c.id} (${c.suggestedType}) ${c.summary}`).join('\n'))
    mark them 'offered'; awaitingAnswer = true (cleared by record_answer, or after 30 s)
```

`record_answer` tool handler:
1. `POST /api/sessions/:id/answers`.
2. The server takes the **verbatim quote** from the expert's transcript utterances between the agent's question and the next agent turn. The tool's `reason_quote` is only the fallback.
3. The moment is marked `answered`.

**Brain panel (visible in the demo):**
- **Screen:** busy / quiet (live bar)
- **Expert:** talking / quiet
- **Budget:** 2/5, next in 30 s
- **Queue:** moments with score, type and a "narrated ✓" tag
- **Why I'm waiting:** e.g. "expert is typing"

**Acceptance:** Process the 3 tacit invoices. You get ≥3 questions, each only after you pause, each naming the invoice or field, at least one STOP/LIMIT/NEVER, and none about INV-4474.

### Phase 5: Trust, Q5 (≈1 h)

**Off the record:**
- The `go_off_record` tool or a panel button sets `setMuted(true)`, pauses capture, calls `POST /off-record {from}`, and shows a red banner: *"Off the record. Nothing is captured."* with a Resume button.
- Resume sets `setMuted(false)`, resumes capture, calls `POST {to}`, and sends `sendContextualUpdate("[BACK_ON_RECORD]")`.
- The server excludes frames, events and utterances inside off-record windows (including the "off the record" sentence itself) from everything downstream.

**PII:**
- `privacy/redact.ts` uses regexes for IBANs, emails and phone numbers. It runs on vision output, transcript and answers before storage.
- Optional: blur `pii_regions` in stored frames with `sharp` and set `FrameRef.redacted = true`.

**Strike from record:** each Work Map item has a "Remove" control. Struck ids are excluded from tutor rendering and exports.

**Pitch line:** frames never leave our server; ElevenLabs only receives short text events. Mention the retention settings ElevenLabs offers for audio.

**Acceptance:** Say "off the record", mention a fake IBAN, then resume. Nothing from that window appears in events, transcript or map.

### Phase 6: Debrief, Work Map and teach-back, Q3 (≈3 h)

**Flow:**
1. The expert clicks **Done with task**. Capture stops and the mode becomes `debrief`.
2. Call `POST /api/sessions/:id/map/draft`, which runs §7.4. It returns a `WorkMap` with `openQuestions.length >= 3`; if fewer, re-ask the model.
3. Web sends `sendContextualUpdate("[WORK_MAP_DRAFT] " + renderCompact(map))`, then `sendUserMessage("[DEBRIEF] Open questions:\n" + list with ids)`.
4. Each `record_answer` (with an open-question id) calls `POST /map/answer`. The server runs `apply_answer` and emits `map_updated`; the UI animates the change.
5. When all questions are answered or skipped, the server emits `ready_for_teachback`. Web sends `sendUserMessage("[TEACHBACK] " + renderCompact(map))`.
6. `submit_correction` calls `POST /map/correction`, which runs `apply_correction`. `confirm_teachback` calls `POST /map/confirm`, which sets `teachback.status = 'confirmed'`, bumps the version and computes coverage.

**`render.ts`:**
- `renderCompact(map)` gives the steps, guardrails and quotes as plain text, under about 3k characters.
- `renderForTutor(map)` gives the same, plus step and guardrail ids, minus struck items.

**DebriefPanel shows:**
- the open questions with checkmarks as they close
- the coverage meter: steps with reason, guardrails with source
- teach-back status
- a **"Done" badge** shown only when all questions are resolved *and* the teach-back is confirmed. This is the Q3 answer.

**Acceptance:** After a capture, the debrief asks ≥3 new questions, the teach-back runs under 60 s, one correction updates the map, and the confirmation locks it.

### Phase 7: Work Map UI (≈1.5 h)

**`WorkMapView`:**
- A vertical, clickable timeline. Each card shows:
  - step n/N and title
  - the decision
  - a judgment-call badge
  - the reason quote with source and timestamp ("live question at 03:15")
  - guardrail chips colored by kind.
- Clicking a card opens a `ReplayModal` with the stored frame at `screenMoment.t`, the quote and the timestamp. Prev/next buttons step through the frames ±5 s around that moment.
- A header summary, e.g. *"7 steps · 3 judgment calls · 4 guardrails · teach-back confirmed"*. That's the brief's own phrasing.
- An "Export JSON" button.

**Acceptance:** Every step and guardrail has a frame and a quote; clicking one opens the right moment.

### Phase 8: Tutor, Q4 (≈3 h)

**Start:**
- **Start training** calls `POST /api/sessions {mode:'teach', mapId, trainee}`. The server marks it as the active teach session.
- `startSession({ agentId: VITE_TUTOR_AGENT_ID, dynamicVariables: { expert_name, trainee_name, task_name, work_map: renderForTutor(map) } })`.
- The trainee shares the ERP window on `/erp?queue=trainee`. Vision events go to the tutor exactly as in Phase 3.

**Applicable steps:**
- When an invoice is opened (vision `opened` event or ERP `GET`, deduplicated), evaluate each step's `appliesWhen` against the `ErpContext`.
- For the first applicable judgment-call step, send `[PREDICT step_id]`; for others, send `[STEP_START step_id]`.
- At most one cue per invoice open, using the same quiet-gating as Phase 4.

**Guardrail risk, the "reaches for opex" moment:**
- On every draft PATCH, evaluate all `violatedWhen` rules with `draft.action = 'approve'` simulated.
- On a new violation, emit `guardrail_risk`. Web sends `sendUserMessage("[GUARDRAIL_RISK] g2 \"Equipment over €5,000 is always capex\" — trainee set cost center 4711 on INV-5102 (€7,200, equipment)")`.
- The panel auto-opens the replay of the guardrail's source moment. The tutor also calls `replay_expert_moment`.

**Save gate:**
- `POST /action` evaluates the rules for real. On a violation it returns 409, the ERP shows the banner, the server emits `guardrail_blocked`, and the web app sends the `[GUARDRAIL_BLOCKED …]` cue.
- **LLM fallback:** if a guardrail has no `violatedWhen`, run a quick `MAP_MODEL` judge call with the guardrail text and the `ErpContext`.

**Mastery:**
- `record_prediction`, guardrail catches and fixes are written as `MasteryRecord`s.
- `MasteryReport` shows, per step and guardrail: mastered ✓, needed a hint, or caught by a guardrail.
- It ends with "Practise next: …" (wrong predictions and caught guardrails first).
- `[SESSION_END]` is sent from an **End training** button.

**Acceptance (the brief's exact test):**
1. On INV-5102, the trainee picks 4711. Within about 2 s the tutor says *"Sabine would stop here. Why do you think?"* and her INV-4471 frame and quote appear.
2. Clicking Approve anyway is blocked by the save gate.
3. After fixing (0400 + AN-20488), the save succeeds.
4. On INV-5105, `[PREDICT]` checks the €5,000 boundary.

### Phase 9: Demo hardening and pitch (≈2 h)

**Demo safety:**
- **Demo seed:** after a good rehearsal, copy the session and map to `data/demo/` and commit them. Add a **"Load Sabine's session"** button so Map and Teach can be demoed even if live capture misbehaves.
- **`ERP_DOM_EVENTS=true` fallback flag:** the ERP emits structured events over socket.io in the same `ScreenEvent` shape, in case vision is flaky on stage. Label it honestly in the UI ("source: ERP" vs "source: vision").

**Practicalities:**
- Rehearse with headphones.
- Pre-warm the agents with one dummy session.
- Keep the ERP at 100% zoom.

**Deliverables:**
- Record the demo video (§9) early. Re-record later if things improve.
- README with setup steps: env, `npx tsx scripts/setup-agents.ts`, `npm run dev`, how to share the window.

### Phase 10: Stretch (optional, in this order)

1. **Agent-ready guardrails.** "Export for agents" downloads `procedure.md` (a trigger plus steps and stop rules in plain language) and `guardrails.json` (JSONLogic). Optionally push it to the tutor as a free-form **Procedure** through the Procedures API (branch-based drafts under `/v1/convai/agents/{agent_id}/branches/{branch_id}/procedures`, published with an agent update), or as a knowledge-base doc via `POST /v1/convai/knowledge-base/text`.
2. **Expert's real voice on replay.** Record the mic locally with `MediaRecorder` during capture and store audio chunks by `t`. `ReplayModal` then plays Sabine's actual words at that moment. This beats a voice clone and needs no extra consent story.
3. **Any language.** The interviewer runs in German (`language: "de"`, or add the `language_detection` system tool). The map stores the original quotes plus English translations, and the tutor teaches in English.
4. **Two experts, one task.** Run a second capture and diff the two maps by step and guardrail. The debrief asks each expert about the differences.

---

## 9. Demo script (≈3 min video) and pitch

1. **(0:00) Problem, 15 s.** Sabine, 24 years in AP, retires in 18 months. Recordings show *what*, not *why*.
2. **(0:15) Capture, 60 s.**
   - Share the ERP. Work INV-4471, 4472 and 4473 at a natural pace.
   - Show the Brain panel: "waiting: expert typing" → quiet → the question.
   - Questions heard: *"You moved 4471 to 0400 — what made you do that?"*, a STOP question on the Czech invoice, a December question.
   - INV-4474 gets no question. Point that out.
   - Do one "off the record".
3. **(1:15) Debrief, 40 s.**
   - Three gap questions, e.g. *"You held the December invoice. Is that for every supplier, and who releases it?"*
   - Teach-back under 60 s; correct one detail; confirm.
4. **(1:55) Work Map, 20 s.** "7 steps · 3 judgment calls · 4 guardrails". Click a step: frame, quote, timestamp.
5. **(2:15) Teach, 35 s.** The new hire opens INV-5102 for €7,200 and picks 4711. *"Sabine would stop here. Why do you think?"* Replay, fix, save passes. Then the mastery report.
6. **(2:50) Moonshot slide, 10 s.** **People first, then agents.** The same Work Map that trains Lena exports as agent procedures plus machine-checkable guardrails. Agents take the routine steps and stop exactly where Sabine would; people keep the judgment calls. The path: one expert today, a living company memory next, where the apprentice only asks about what changed.

### Apprentice Test, one-liners for the pitch

1. **When to ask.** Screen stillness + voice silence + a question budget, plus `sendUserActivity` while the screen moves. All of it is visible in the Brain panel.
2. **What to ask.** Scored moments: deviations, non-default actions and lookups. Anything already narrated is skipped, and guardrail questions get priority.
3. **When it has understood.** Every open question is closed, the expert confirmed the teach-back, and coverage is 100% of steps with a reason.
4. **Whether the new hire learned.** An unseen case, predictions before judgment calls, a guardrail caught before save, and a mastery report.
5. **Trust.** "Off the record" mutes and drops that window, PII is redacted, frames stay local, and the expert can strike anything.

---

## 10. Risks and fallbacks

| Risk | Fallback |
|---|---|
| Agent talks while the expert works | Strengthen the skip_turn wording, keep `turn_eagerness: "patient"`, make sure `sendUserActivity` fires, and test in the dashboard first |
| Vision misreads fields | Bigger ERP fonts and labels; pass `prevState`; switch `VISION_MODEL` to `claude-sonnet-5-5`; `ERP_DOM_EVENTS=true` as a last resort |
| Echo: the agent hears itself | Headphones |
| `onVadScore` never fires | Add `vad_score` to client events (§6), or fall back to `onMessage` tentative user transcripts as the "talking" signal |
| Map quotes not verbatim | Server-side quote extraction from the transcript (Phase 4); the map builder may only cite utterance ids |
| Live demo fails | "Load Sabine's session" seed plus the pre-recorded video |
| Running out of time | Cut, in this order: Phase 10 → frame blur → LLM narration check (rules only) → mastery detail. Never cut the INV-5102 catch. |

---

## 11. Time budget (solo)

| Phase | Hours | Running total |
|---|---|---|
| 0 Scaffold | 0.5 | 0.5 |
| 1 ERP | 1.5 | 2.0 |
| 2 Agents script | 0.75 | 2.75 |
| 3 Voice + vision | 3.0 | 5.75 |
| 4 Moments (Q1/Q2) | 2.0 | 7.75 |
| 5 Trust | 1.0 | 8.75 |
| 6 Debrief + map | 3.0 | 11.75 |
| 7 Map UI | 1.5 | 13.25 |
| 8 Tutor | 3.0 | 16.25 |
| 9 Hardening + video | 2.0 | 18.25 |

Check the submission deadline now and work backwards. Plan a sleep block between Phase 6 and Phase 7: the capture side is done by then and the risky part is behind you.