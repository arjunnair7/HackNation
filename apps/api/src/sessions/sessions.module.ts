import { Module } from '@nestjs/common';
import { ErpModule } from '../erp/erp.module';
import { LlmModule } from '../llm/llm.module';
import { MomentsService } from '../moments/moments.service';
import { RealtimeModule } from '../realtime/realtime.module';
import { VisionService } from '../vision/vision.service';
import { SessionStore } from './session.store';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

@Module({
  imports: [LlmModule, RealtimeModule, ErpModule],
  controllers: [SessionsController],
  providers: [SessionStore, SessionsService, VisionService, MomentsService],
  exports: [SessionStore, SessionsService],
})
export class SessionsModule {}
