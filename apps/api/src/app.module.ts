import { Module } from '@nestjs/common';
import { ErpHttpModule } from './erp/erp-http.module';
import { LlmModule } from './llm/llm.module';
import { RealtimeModule } from './realtime/realtime.module';
import { SessionsModule } from './sessions/sessions.module';
import { WorkMapModule } from './workmap/workmap.module';

@Module({
  imports: [LlmModule, RealtimeModule, SessionsModule, ErpHttpModule, WorkMapModule],
})
export class AppModule {}
