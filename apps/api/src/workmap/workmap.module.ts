import { Module } from '@nestjs/common';
import { ErpModule } from '../erp/erp.module';
import { LlmModule } from '../llm/llm.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SessionsModule } from '../sessions/sessions.module';
import { WorkMapController } from './workmap.controller';
import { WorkMapService } from './workmap.service';

@Module({
  imports: [LlmModule, RealtimeModule, ErpModule, SessionsModule],
  controllers: [WorkMapController],
  providers: [WorkMapService],
  exports: [WorkMapService],
})
export class WorkMapModule {}
