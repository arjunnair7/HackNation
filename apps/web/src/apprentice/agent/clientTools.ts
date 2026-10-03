import { useConversationClientTool } from '@elevenlabs/react'
import type { InterviewerToolName, TutorToolName } from '@apprentice/shared'

export type ToolName = InterviewerToolName | TutorToolName
export type ToolCallListener = (name: ToolName, params: Record<string, unknown>) => void

/**
 * Registers every client tool that scripts/setup-agents.ts created (names must match exactly).
 * Phase 3: stubs that only report the call. Later phases replace them one by one:
 * record_answer (4), go_off_record (5), submit_correction / confirm_teachback (6), tutor tools (8).
 */
export function useApprenticeClientTools(onCall: ToolCallListener) {
  useStubTool('record_answer', onCall)
  useStubTool('go_off_record', onCall)
  useStubTool('submit_correction', onCall)
  useStubTool('confirm_teachback', onCall)
  useStubTool('record_prediction', onCall)
  useStubTool('replay_expert_moment', onCall)
  useStubTool('show_mastery_report', onCall)
}

function useStubTool(name: ToolName, onCall: ToolCallListener) {
  // expects_response is false on every tool, so the agent never waits for a return value.
  useConversationClientTool(name, (params: Record<string, unknown>) => {
    onCall(name, params)
  })
}
