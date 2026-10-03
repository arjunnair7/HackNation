// Written into .env.local by apps/api/scripts/setup-agents.ts
interface ImportMetaEnv {
  readonly VITE_INTERVIEWER_AGENT_ID?: string
  readonly VITE_TUTOR_AGENT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
