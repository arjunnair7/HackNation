/**
 * Creates or updates the two ElevenLabs agents (Interviewer, Tutor) and their client tools.
 * BUILD_PLAN §6 + §7. Idempotent: ids live in apps/api/.agents.json; known ids are PATCHed,
 * missing ones are created. Finally writes VITE_*_AGENT_ID into apps/web/.env.local.
 *
 *   cd apps/api && npx tsx scripts/setup-agents.ts            # create / update
 *   cd apps/api && npx tsx scripts/setup-agents.ts --dry-run  # print payloads, no API calls
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { InterviewerToolName, TutorToolName } from '@apprentice/shared';
import { INTERVIEWER_FIRST_MESSAGE, INTERVIEWER_PROMPT } from '../src/prompts/interviewer';
import { TUTOR_FIRST_MESSAGE, TUTOR_PROMPT } from '../src/prompts/tutor';

const API = 'https://api.elevenlabs.io/v1';
const API_DIR = join(__dirname, '..');
const STATE_FILE = join(API_DIR, '.agents.json');
const WEB_ENV_FILE = join(API_DIR, '..', 'web', '.env.local');

const envFile = join(API_DIR, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const DRY_RUN = process.argv.includes('--dry-run');
const API_KEY = process.env.ELEVENLABS_API_KEY ?? '';
const AGENT_LLM = process.env.AGENT_LLM || 'claude-sonnet-4-5';
const TTS_MODEL_ID = process.env.TTS_MODEL_ID ?? '';
const VOICE_ID = process.env.VOICE_ID ?? '';

// --- client tools (§6) -------------------------------------------------------

type Role = 'interviewer' | 'tutor';
type ToolName = InterviewerToolName | TutorToolName;

interface ParamSpec {
  type: 'string' | 'boolean';
  description: string;
  enum?: string[];
}

interface ToolSpec {
  description: string;
  params?: Record<string, ParamSpec>;
  required?: string[];
}

const INTERVIEWER_TOOLS: Record<InterviewerToolName, ToolSpec> = {
  record_answer: {
    description:
      'Call right after the expert answers one of your questions. Records their reason in their own words. Only after they have replied to a question you asked out loud, never in the same turn as asking it.',
    params: {
      moment_id: { type: 'string', description: 'The candidate or open-question id you asked about.' },
      reason_quote: { type: 'string', description: "The expert's words, verbatim as far as possible." },
      decision_summary: { type: 'string', description: 'One short sentence: what the expert decided.' },
      guardrail_text: {
        type: 'string',
        description: 'A limit, exception, stop-and-ask or never-rule the expert stated, if any.',
      },
      guardrail_kind: {
        type: 'string',
        description: 'Kind of the stated guardrail, if any.',
        enum: ['limit', 'exception', 'stop_and_ask', 'never', 'rule'],
      },
    },
    required: ['moment_id', 'reason_quote'],
  },
  go_off_record: {
    description:
      'Call immediately when the expert says "off the record" or asks you not to record something.',
  },
  submit_correction: {
    description: 'Call during teach-back when the expert corrects your explanation.',
    params: { correction: { type: 'string', description: "The expert's correction, in their words." } },
    required: ['correction'],
  },
  confirm_teachback: {
    description: 'Call when the expert confirms your teach-back is how it works.',
  },
};

const TUTOR_TOOLS: Record<TutorToolName, ToolSpec> = {
  record_prediction: {
    description: 'Call after the trainee predicts a decision you asked about.',
    params: {
      step_id: { type: 'string', description: 'The Work Map step id the prediction was about.' },
      correct: { type: 'boolean', description: "True if the prediction matches the expert's decision." },
      trainee_answer: { type: 'string', description: "The trainee's prediction, in their words." },
    },
    required: ['step_id', 'correct'],
  },
  replay_expert_moment: {
    description:
      "Shows the trainee the expert's screen moment and words for a step. Call when explaining a guardrail or a decision.",
    params: { step_id: { type: 'string', description: 'The Work Map step id to replay.' } },
    required: ['step_id'],
  },
  show_mastery_report: {
    description: 'Call at session end to show what the trainee mastered.',
  },
};

function toolConfig(name: ToolName, spec: ToolSpec) {
  return {
    type: 'client',
    name,
    description: spec.description,
    expects_response: false, // the agent never waits on the app
    ...(spec.params && {
      parameters: { type: 'object', properties: spec.params, required: spec.required ?? [] },
    }),
  };
}

// --- agents (§6 config, §7 prompts) -----------------------------------------

const SKIP_TURN = {
  type: 'system',
  name: 'skip_turn',
  description:
    'Call this to stay silent: when the person is working, reading, thinking aloud or talking to themselves without addressing you, or when you get a turn only because of silence. Never call it in reply to an app cue ([ASK_NOW], [DEBRIEF], [TEACHBACK], [STEP_START], [PREDICT], [GUARDRAIL_RISK], [GUARDRAIL_BLOCKED], [SESSION_END]).',
  params: { system_tool_type: 'skip_turn' },
};

// Setting client_events replaces ElevenLabs' defaults, so keep them (first six) and add what
// the web app needs: client_tool_call for the tool handlers, vad_score for "expert is talking" (Phase 4).
const CLIENT_EVENTS = [
  'audio',
  'interruption',
  'agent_response',
  'user_transcript',
  'agent_response_correction',
  'agent_tool_response',
  'client_tool_call',
  'vad_score',
];

// Dashboard-testing defaults only; the web app passes real values to startSession().
const PLACEHOLDERS = {
  expert_name: 'Sabine',
  expert_role: 'accounts payable lead',
  trainee_name: 'Lena',
  task_name: 'processing supplier invoices before period close',
  work_map: '(no work map yet)',
};

const AGENTS: Record<Role, { name: string; prompt: string; firstMessage: string; tools: ToolName[] }> = {
  interviewer: {
    name: 'Apprentice – Interviewer',
    prompt: INTERVIEWER_PROMPT,
    firstMessage: INTERVIEWER_FIRST_MESSAGE,
    tools: Object.keys(INTERVIEWER_TOOLS) as InterviewerToolName[],
  },
  tutor: {
    name: 'Apprentice – Tutor',
    prompt: TUTOR_PROMPT,
    firstMessage: TUTOR_FIRST_MESSAGE,
    tools: Object.keys(TUTOR_TOOLS) as TutorToolName[],
  },
};

function agentConfig(role: Role, toolIds: string[]) {
  const a = AGENTS[role];
  // Empty TTS_MODEL_ID / VOICE_ID → leave them to the dashboard (§6 Expressive Mode note).
  const tts = { ...(TTS_MODEL_ID && { model_id: TTS_MODEL_ID }), ...(VOICE_ID && { voice_id: VOICE_ID }) };
  return {
    name: a.name,
    conversation_config: {
      agent: {
        first_message: a.firstMessage,
        language: 'en',
        prompt: {
          prompt: a.prompt,
          llm: AGENT_LLM,
          temperature: 0.3,
          tool_ids: toolIds,
          built_in_tools: { skip_turn: SKIP_TURN },
        },
        dynamic_variables: { dynamic_variable_placeholders: PLACEHOLDERS },
      },
      ...(Object.keys(tts).length > 0 && { tts }),
      turn: { turn_timeout: 30, turn_eagerness: 'patient' },
      conversation: { max_duration_seconds: 1800, client_events: CLIENT_EVENTS },
    },
  };
}

// --- ElevenLabs API -----------------------------------------------------------

class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function api<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'xi-api-key': API_KEY, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new ApiError(res.status, `${method} ${path} → ${res.status}\n${text}`);
  return (text ? JSON.parse(text) : {}) as T;
}

/** PATCH the known id; create when there is none or it was deleted in the dashboard. */
async function upsert(
  label: string,
  id: string | undefined,
  update: (id: string) => Promise<unknown>,
  create: () => Promise<string>,
): Promise<string> {
  if (id) {
    try {
      await update(id);
      console.log(`  updated ${label} (${id})`);
      return id;
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) throw err;
      console.log(`  ${label} ${id} no longer exists, creating a new one`);
    }
  }
  const created = await create();
  console.log(`  created ${label} (${created})`);
  return created;
}

// --- local state ---------------------------------------------------------------

interface State {
  tools: Partial<Record<ToolName, string>>;
  agents: Partial<Record<Role, string>>;
}

function loadState(): State {
  if (!existsSync(STATE_FILE)) return { tools: {}, agents: {} };
  const s = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as Partial<State>;
  return { tools: s.tools ?? {}, agents: s.agents ?? {} };
}

function saveState(state: State) {
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

/** Set VITE_* keys in apps/web/.env.local, keeping any other lines. */
function writeWebEnv(values: Record<string, string>) {
  const text = existsSync(WEB_ENV_FILE) ? readFileSync(WEB_ENV_FILE, 'utf8').trimEnd() : '';
  const lines = text ? text.split('\n') : [];
  for (const [key, value] of Object.entries(values)) {
    const i = lines.findIndex((l) => l.startsWith(`${key}=`));
    if (i >= 0) lines[i] = `${key}=${value}`;
    else lines.push(`${key}=${value}`);
  }
  writeFileSync(WEB_ENV_FILE, `${lines.join('\n')}\n`);
}

// --- main -----------------------------------------------------------------------

async function validateLlm() {
  const { llms } = await api<{ llms: { llm: string; deprecation_info?: { is_deprecated?: boolean } }[] }>(
    'GET',
    '/convai/llm/list',
  );
  const match = llms.find((l) => l.llm === AGENT_LLM);
  if (!match) {
    const claude = llms.map((l) => l.llm).filter((id) => id.includes('claude'));
    console.error(`AGENT_LLM "${AGENT_LLM}" is not available in ElevenLabs Agents.`);
    console.error(`Claude options: ${claude.join(', ') || '(none listed)'}`);
    process.exit(1);
  }
  if (match.deprecation_info?.is_deprecated) console.warn(`  warning: ${AGENT_LLM} is marked deprecated`);
  console.log(`  LLM ok: ${AGENT_LLM}`);
}

async function main() {
  const allTools: [ToolName, ToolSpec][] = [
    ...(Object.entries(INTERVIEWER_TOOLS) as [ToolName, ToolSpec][]),
    ...(Object.entries(TUTOR_TOOLS) as [ToolName, ToolSpec][]),
  ];

  if (DRY_RUN) {
    const fakeIds = (role: Role) => AGENTS[role].tools.map((t) => `<${t} id>`);
    console.log(JSON.stringify({
      tools: allTools.map(([name, spec]) => ({ tool_config: toolConfig(name, spec) })),
      interviewer: agentConfig('interviewer', fakeIds('interviewer')),
      tutor: agentConfig('tutor', fakeIds('tutor')),
    }, null, 2));
    return;
  }
  if (!API_KEY) {
    console.error('ELEVENLABS_API_KEY is missing in apps/api/.env (or run with --dry-run to print the payloads).');
    process.exit(1);
  }

  console.log('1. Validate LLM');
  await validateLlm();

  const state = loadState();

  console.log('2. Client tools');
  for (const [name, spec] of allTools) {
    const tool_config = toolConfig(name, spec);
    state.tools[name] = await upsert(
      `tool ${name}`,
      state.tools[name],
      (id) => api('PATCH', `/convai/tools/${id}`, { tool_config }),
      async () => (await api<{ id: string }>('POST', '/convai/tools', { tool_config })).id,
    );
    saveState(state); // after every step, so a failed run never leaves orphans behind
  }

  console.log('3. Agents');
  for (const role of Object.keys(AGENTS) as Role[]) {
    const body = agentConfig(role, AGENTS[role].tools.map((t) => state.tools[t]!));
    state.agents[role] = await upsert(
      `${role} agent`,
      state.agents[role],
      (id) => api('PATCH', `/convai/agents/${id}`, body),
      async () => (await api<{ agent_id: string }>('POST', '/convai/agents/create', body)).agent_id,
    );
    saveState(state);
  }

  writeWebEnv({
    VITE_INTERVIEWER_AGENT_ID: state.agents.interviewer!,
    VITE_TUTOR_AGENT_ID: state.agents.tutor!,
  });

  console.log(`\nIds saved to ${STATE_FILE}; agent ids written to ${WEB_ENV_FILE}.`);
  for (const role of Object.keys(AGENTS) as Role[]) {
    console.log(`  ${AGENTS[role].name}: https://elevenlabs.io/app/agents/agents/${state.agents[role]}`);
  }
  if (!TTS_MODEL_ID) console.log('Note: TTS_MODEL_ID is empty, so pick "V3 Conversational" in each agent\'s Voice tab.');
}

main().catch((err: unknown) => {
  console.error(`\nsetup-agents failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
