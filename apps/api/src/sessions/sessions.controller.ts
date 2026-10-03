import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Res } from '@nestjs/common';
import { existsSync } from 'node:fs';
import type { Response } from 'express';
import type { FrameUploadResponse, ScreenEvent, Session, Utterance } from '@apprentice/shared';
import { SessionStore } from './session.store';
import { SessionsService } from './sessions.service';

@Controller('sessions')
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly store: SessionStore,
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

  /** Body: DebugEventRequest. Debug drawer only. */
  @Post(':id/events')
  debugEvent(@Param('id') id: string, @Body() body: unknown): ScreenEvent {
    return this.sessions.addDebugEvent(id, body);
  }
}
