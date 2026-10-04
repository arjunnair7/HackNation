import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import type { MasteryRecord } from '@apprentice/shared';
import { GuardrailService } from './guardrails.service';

@Controller('sessions')
export class GuardrailsController {
  constructor(private readonly guardrails: GuardrailService) {}

  /** Body: RecordPredictionRequest (record_prediction client tool). Returns the session's mastery records. */
  @Post(':id/mastery')
  @HttpCode(200)
  prediction(@Param('id') id: string, @Body() body: unknown): MasteryRecord[] {
    return this.guardrails.recordPrediction(id, body);
  }
}
