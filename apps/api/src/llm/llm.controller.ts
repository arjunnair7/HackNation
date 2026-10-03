import Anthropic from '@anthropic-ai/sdk';
import { Controller, Get, Query, ServiceUnavailableException } from '@nestjs/common';
import { AnthropicService, LlmError, type ToolDef } from './anthropic.service';

const TEST_TOOL: ToolDef = {
  name: 'report_event',
  description: 'Report one change seen on an accounts-payable screen.',
  input_schema: {
    type: 'object',
    required: ['kind', 'description'],
    properties: {
      kind: { type: 'string', enum: ['opened', 'navigated', 'field_changed', 'action', 'lookup', 'typed', 'read', 'other'] },
      entity: { type: 'string' },
      field: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      description: { type: 'string' },
    },
  },
};

/** Phase 0 smoke test: GET /api/llm/test[?model=…] → a callTool result from Claude. */
@Controller('llm')
export class LlmController {
  constructor(private readonly llm: AnthropicService) {}

  @Get('test')
  async test(@Query('model') model?: string) {
    const chosen = model || process.env.VISION_MODEL || 'claude-haiku-4-5-20251001';
    const started = Date.now();
    try {
      const result = await this.llm.callTool<Record<string, string>>({
        model: chosen,
        system: 'You turn descriptions of screen changes into structured events.',
        content:
          'On invoice INV-4471 the cost center dropdown changed from "4711 · Maintenance & Repairs" to "0400 · Capital Equipment".',
        tool: TEST_TOOL,
        maxTokens: 1024,
      });
      return { model: chosen, forcedToolChoice: AnthropicService.forcesToolChoice(chosen), ms: Date.now() - started, result };
    } catch (err) {
      // Smoke test: surface every failure (API errors, refusals, missing credentials) as a readable 503.
      const status = err instanceof Anthropic.APIError ? err.status : undefined;
      // .env is read once at boot; the watcher doesn't reload it.
      const hint =
        err instanceof LlmError || status ? undefined : 'set ANTHROPIC_API_KEY in apps/api/.env, then restart npm run dev';
      throw new ServiceUnavailableException({ model: chosen, status, error: (err as Error).message, hint });
    }
  }
}
