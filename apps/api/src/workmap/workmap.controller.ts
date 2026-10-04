import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import type { MapDraftResponse, MapSummary, TutorMapResponse, WorkMap } from '@apprentice/shared';
import { WorkMapService } from './workmap.service';

@Controller()
export class WorkMapController {
  constructor(private readonly maps: WorkMapService) {}

  /** "Done with task": runs the §7.4 map builder (Sonnet, ~30–60 s) and switches the session to debrief. */
  @Post('sessions/:id/map/draft')
  @HttpCode(200)
  draft(@Param('id') id: string): Promise<MapDraftResponse> {
    return this.maps.draft(id);
  }

  @Get('sessions/:id/map')
  get(@Param('id') id: string): WorkMap {
    return this.maps.get(id);
  }

  /** Body: MapAnswerRequest. */
  @Post('sessions/:id/map/answer')
  @HttpCode(200)
  answer(@Param('id') id: string, @Body() body: unknown): Promise<WorkMap> {
    return this.maps.answer(id, body);
  }

  /** Body: MapCorrectionRequest. */
  @Post('sessions/:id/map/correction')
  @HttpCode(200)
  correction(@Param('id') id: string, @Body() body: unknown): Promise<WorkMap> {
    return this.maps.correction(id, body);
  }

  /** Body: MapStrikeRequest. */
  @Post('sessions/:id/map/strike')
  @HttpCode(200)
  strike(@Param('id') id: string, @Body() body: unknown): Promise<WorkMap> {
    return this.maps.strike(id, body);
  }

  @Post('sessions/:id/map/confirm')
  @HttpCode(200)
  confirm(@Param('id') id: string): Promise<WorkMap> {
    return this.maps.confirm(id);
  }

  @Get('maps')
  list(): MapSummary[] {
    return this.maps.list();
  }

  @Get('maps/:mapId/tutor')
  tutor(@Param('mapId') mapId: string): TutorMapResponse {
    return this.maps.tutor(mapId);
  }

  @Get('maps/:mapId')
  byId(@Param('mapId') mapId: string): WorkMap {
    return this.maps.getById(mapId);
  }
}
