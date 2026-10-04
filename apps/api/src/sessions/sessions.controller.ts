import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Res } from '@nestjs/common';
import { existsSync } from 'node:fs';
import type { Response } from 'express';
import type { Answer, FrameUploadResponse, Moment, ScreenEvent, Session, Utterance } from '@apprentice/shared';
import { MomentsService } from '../moments/moments.service';
import { SessionStore } from './session.store';
import { SessionsService } from './sessions.service';

@Controller('sessions')
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly store: SessionStore,
    private readonly moments: MomentsService,
  ) {}

  /** Body: CreateSessionRequest (defaults to a capture session with Sabine). */
  @Post()
  create(@Body() body: unknown): Session {
    return this.sessions.create(body);
  }

  @Get(':id')
  get(@Param('id') id: string): Session {
    return this.store.require(id);
  }

  /** Body: TranscriptRequest. Final transcript lines from the voice agent. */
  @Post(':id/transcript')
  transcript(@Param('id') id: string, @Body() body: unknown): Utterance {
    return this.sessions.addUtterance(id, body);
  }

  /** Body: FrameUploadRequest. 202: vision runs in the background and reports over the socket. */
  @Post(':id/frames')
  @HttpCode(202)
  frame(@Param('id') id: string, @Body() body: unknown): FrameUploadResponse {
    return this.sessions.addFrame(id, body);
  }

  @Get(':id/frames/:frameId')
  frameImage(@Param('id') id: string, @Param('frameId') frameId: string, @Res() res: Response): void {
    const frame = this.store.require(id).frames.find((f) => f.id === frameId);
    const file = frame && this.store.frameFile(id, frame.path);
    if (!file || !existsSync(file)) throw new NotFoundException(`Frame ${frameId} not found`);
    res.type('image/jpeg').sendFile(file);
  }

  /** Body: RecordAnswerRequest (record_answer client tool). Waits ~1.5 s so the expert's last line is in. */
  @Post(':id/answers')
  answer(@Param('id') id: string, @Body() body: unknown): Promise<Answer> {
    return this.moments.recordAnswer(id, body);
  }

  /** Body: MomentStatusRequest. The web detector marks candidates offered / expired. */
  @Post(':id/moments/status')
  @HttpCode(200)
  momentStatus(@Param('id') id: string, @Body() body: unknown): Moment[] {
    return this.moments.setStatus(id, body);
  }

  /** End a session; for a teach session this switches the save gate off. */
  @Post(':id/end')
  @HttpCode(200)
  end(@Param('id') id: string): { ended: true } {
    return this.sessions.end(id);
  }

  /** Body: OffRecordRequest. { from } opens a window and purges what it covers; { to } closes it. */
  @Post(':id/off-record')
  @HttpCode(200)
  offRecord(@Param('id') id: string, @Body() body: unknown): Session['offRecord'] {
    return this.sessions.setOffRecord(id, body);
  }

  /** Body: StrikeRequest. Returns the session's struck ids. */
  @Post(':id/strike')
  @HttpCode(200)
  strike(@Param('id') id: string, @Body() body: unknown): string[] {
    return this.sessions.strike(id, body);
  }

  /** Body: DebugEventRequest. Debug drawer only. */
  @Post(':id/events')
  debugEvent(@Param('id') id: string, @Body() body: unknown): ScreenEvent {
    return this.sessions.addDebugEvent(id, body);
  }
}
