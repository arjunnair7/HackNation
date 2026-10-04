import { Module } from '@nestjs/common';
import { ErpModule } from '../erp/erp.module';
import { LlmModule } from '../llm/llm.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SessionsModule } from '../sessions/sessions.module';
import { WorkMapModule } from '../workmap/workmap.module';
import { GuardrailsController } from './guardrails.controller';
import { GuardrailService } from './guardrails.service';

@Module({
  imports: [ErpModule, LlmModule, RealtimeModule, SessionsModule, WorkMapModule],
  controllers: [GuardrailsController],
  providers: [GuardrailService],
  exports: [GuardrailService],
})
export class GuardrailsModule {}
