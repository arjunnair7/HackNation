import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { VisionService } from '../vision/vision.service';
import { SessionStore } from './session.store';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

@Module({
  imports: [LlmModule, RealtimeModule],
  controllers: [SessionsController],
  providers: [SessionStore, SessionsService, VisionService],
  exports: [SessionStore, SessionsService],
})
export class SessionsModule {}
