import { useConversationClientTool } from '@elevenlabs/react'
import type { InterviewerToolName, TutorToolName } from '@apprentice/shared'

export type ToolName = InterviewerToolName | TutorToolName
export type ToolParams = Record<string, unknown>
export type ToolHandlers = Partial<Record<ToolName, (params: ToolParams) => void>>
export type ToolCallListener = (name: ToolName, params: ToolParams) => void

/**
 * Registers every client tool that scripts/setup-agents.ts created (names must match exactly).
 * Each call is reported to onCall; tools with a handler also run it. So far: record_answer (Phase 4).
 * Still stubs: go_off_record (5), submit_correction / confirm_teachback (6), tutor tools (8).
 */
export function useApprenticeClientTools(handlers: ToolHandlers, onCall: ToolCallListener) {
  useTool('record_answer', handlers, onCall)
  useTool('go_off_record', handlers, onCall)
  useTool('submit_correction', handlers, onCall)
  useTool('confirm_teachback', handlers, onCall)
  useTool('record_prediction', handlers, onCall)
  useTool('replay_expert_moment', handlers, onCall)
  useTool('show_mastery_report', handlers, onCall)
}

function useTool(name: ToolName, handlers: ToolHandlers, onCall: ToolCallListener) {
  // expects_response is false on every tool, so the agent never waits for a return value.
  useConversationClientTool(name, (params: ToolParams) => {
    onCall(name, params)
    handlers[name]?.(params)
  })
}
