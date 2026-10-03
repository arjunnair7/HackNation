import { Module } from '@nestjs/common';
import { AnthropicService } from './anthropic.service';
import { LlmController } from './llm.controller';

@Module({
  controllers: [LlmController],
  providers: [AnthropicService],
  exports: [AnthropicService],
})
export class LlmModule {}
