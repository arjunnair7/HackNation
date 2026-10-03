import { BadRequestException, Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import type { ErpInvoiceDetail, ErpInvoiceSummary, ErpQueue, InvoiceDraft } from '@apprentice/shared';
import { ErpService, QUEUES } from './erp.service';

@Controller('erp')
export class ErpController {
  constructor(private readonly erp: ErpService) {}

  /** GET /api/erp/invoices?queue=expert|trainee (all invoices without a queue). */
  @Get('invoices')
  list(@Query('queue') queue?: string): ErpInvoiceSummary[] {
    if (queue && !(QUEUES as readonly string[]).includes(queue)) {
      throw new BadRequestException(`queue must be one of: ${QUEUES.join(', ')}`);
    }
    return this.erp.list(queue as ErpQueue | undefined);
  }

  @Get('invoices/:id')
  get(@Param('id') id: string): ErpInvoiceDetail {
    return this.erp.getDetail(id);
  }

  /** Autosaved edits (cost center, asset number, comment). Body: DraftPatch. */
  @Patch('invoices/:id/draft')
  patchDraft(@Param('id') id: string, @Body() body: unknown): InvoiceDraft {
    return this.erp.patchDraft(id, body);
  }

  /** Approve / hold / route. Body: ErpActionRequest. The guardrail save gate is added in Phase 8. */
  @Post('invoices/:id/action')
  @HttpCode(200)
  action(@Param('id') id: string, @Body() body: unknown): ErpInvoiceDetail {
    return this.erp.applyAction(id, body);
  }

  @Post('reset')
  @HttpCode(200)
  reset(): { ok: true } {
    this.erp.reset();
    return { ok: true };
  }
}
