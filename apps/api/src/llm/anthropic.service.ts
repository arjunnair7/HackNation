import Anthropic from '@anthropic-ai/sdk';
import { Injectable } from '@nestjs/common';

export type ContentBlock = Anthropic.Beta.BetaContentBlockParam;
export type ToolDef = Anthropic.Beta.BetaTool;

export interface CallToolOptions {
  model: string;
  system: string;
  content: string | ContentBlock[];
  tool: ToolDef;
  maxTokens?: number;
  /** Thinking depth on models that support it (Sonnet/Opus 5.x); leave unset for Haiku. */
  effort?: 'low' | 'medium' | 'high';
}

// These models reject forced tool_choice ({type:'tool'}) with a 400, so they get
// tool_choice auto + an explicit instruction, and a retry if no call comes back.
const NO_FORCED_TOOL_CHOICE = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-mythos-5-1']);
// Server-side refusal fallback (`fallbacks: 'default'`) is supported for these.
const SERVER_FALLBACK = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-fable-5-1']);

export class LlmError extends Error {}

@Injectable()
export class AnthropicService {
  private client?: Anthropic;

  /** Created lazily so the API boots without credentials; the SDK resolves them from env / `ant auth` profile. */
  private get anthropic(): Anthropic {
    return (this.client ??= new Anthropic());
  }

  /** JPEG frame as an image content block. */
  static jpeg(base64: string): ContentBlock {
    return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } };
  }

  static forcesToolChoice(model: string): boolean {
    return !NO_FORCED_TOOL_CHOICE.has(model);
  }

  /** One call that must answer through `tool`; returns the tool input as T. */
  async callTool<T>({ model, system, content, tool, maxTokens = 16000, effort }: CallToolOptions): Promise<T> {
    const forced = AnthropicService.forcesToolChoice(model);
    const fallback = SERVER_FALLBACK.has(model);

    for (let attempt = 1; attempt <= 2; attempt++) {
      const response = await this.anthropic.beta.messages.create({
        model,
        max_tokens: maxTokens,
        system: forced ? system : `${system}\n\nRespond only by calling the ${tool.name} tool.`,
        tools: [tool],
        tool_choice: forced ? { type: 'tool', name: tool.name } : { type: 'auto' },
        messages: [{ role: 'user', content }],
        ...(effort ? { output_config: { effort } } : {}),
        ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      });

      if (response.stop_reason === 'refusal') {
        throw new LlmError(`${model} declined the request (${response.stop_details?.category ?? 'no category'})`);
      }
      if (response.stop_reason === 'max_tokens') {
        throw new LlmError(`${model} hit max_tokens (${maxTokens}) before finishing ${tool.name}`);
      }
      const call = response.content.find(
        (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use' && b.name === tool.name,
      );
      if (call) return call.input as T;
      if (forced) break; // a forced call that didn't happen won't happen on retry either
    }
    throw new LlmError(`${model} did not call ${tool.name}`);
  }
}
