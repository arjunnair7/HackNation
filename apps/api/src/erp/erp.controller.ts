import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import type { ErpGuardrailBlock, ErpInvoiceDetail, ErpInvoiceSummary, ErpQueue, InvoiceDraft } from '@apprentice/shared';
import { GuardrailService } from '../guardrails/guardrails.service';
import { ErpService, QUEUES } from './erp.service';

@Controller('erp')
export class ErpController {
  constructor(
    private readonly erp: ErpService,
    private readonly guardrails: GuardrailService,
  ) {}

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
    const detail = this.erp.getDetail(id);
    this.guardrails.onInvoiceOpened(detail.invoice.id); // tutor: [PREDICT] / [STEP_START]
    return detail;
  }

  /** Autosaved edits (cost center, asset number, comment). Body: DraftPatch. */
  @Patch('invoices/:id/draft')
  patchDraft(@Param('id') id: string, @Body() body: unknown): InvoiceDraft {
    const draft = this.erp.patchDraft(id, body);
    this.guardrails.onDraftChanged(id.toUpperCase()); // tutor: guardrail risk, once the edit settles
    return draft;
  }

  /**
   * Approve / hold / route. Body: ErpActionRequest. While a teach session is active the save gate
   * runs first: a violated guardrail answers 409 ErpGuardrailBlock and nothing is saved.
   */
  @Post('invoices/:id/action')
  @HttpCode(200)
  async action(@Param('id') id: string, @Body() body: unknown): Promise<ErpInvoiceDetail> {
    const blocked = await this.guardrails.gate(id, body);
    if (blocked) {
      const response: ErpGuardrailBlock = { error: 'guardrail_blocked', guardrail: { id: blocked.id, kind: blocked.kind, text: blocked.text } };
      throw new ConflictException(response);
    }
    const detail = this.erp.applyAction(id, body);
    this.guardrails.afterSave(detail.invoice.id);
    return detail;
  }

  @Post('reset')
  @HttpCode(200)
  reset(): { ok: true } {
    this.erp.reset();
    return { ok: true };
  }
}
