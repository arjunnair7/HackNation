import { Module } from '@nestjs/common';
import { SessionStore } from './session.store';

// Phase 3 adds sessions.controller.ts / sessions.service.ts here.
@Module({
  providers: [SessionStore],
  exports: [SessionStore],
})
export class SessionsModule {}
