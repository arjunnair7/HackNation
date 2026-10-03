import { Module } from '@nestjs/common';
import { ErpModule } from './erp/erp.module';
import { LlmModule } from './llm/llm.module';
import { RealtimeModule } from './realtime/realtime.module';
import { SessionsModule } from './sessions/sessions.module';

@Module({
  imports: [LlmModule, RealtimeModule, SessionsModule, ErpModule],
})
export class AppModule {}
