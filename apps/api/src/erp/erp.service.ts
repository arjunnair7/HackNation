import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
  DraftPatch,
  ErpAction,
  ErpActionRequest,
  ErpContext,
  ErpInvoiceDetail,
  ErpInvoiceSummary,
  ErpQueue,
  Invoice,
  InvoiceDraft,
  InvoiceStatus,
  RouteTarget,
} from '@apprentice/shared';
import { dataDir } from '../common/paths';
import { COST_CENTERS, INVOICES, SUPPLIERS, SUPPLIER_HISTORY, initialDraft } from './seed';

interface InvoiceState { draft: InvoiceDraft; status: InvoiceStatus; processedAt?: string }
type ErpState = Record<string, InvoiceState>;

export const QUEUES: readonly ErpQueue[] = ['expert', 'trainee'];
const ACTIONS: readonly ErpAction[] = ['approve', 'hold', 'route'];
const ROUTE_TARGETS: readonly RouteTarget[] = ['controller', 'intercompany'];
const STATUS_AFTER: Record<ErpAction, InvoiceStatus> = { approve: 'posted', hold: 'on_hold', route: 'routed' };

/**
 * Sandbox AP system. Seed data is static (seed.ts); the mutable part (draft, status)
 * lives in memory and is persisted to data/erp/state.json.
 */
@Injectable()
export class ErpService {
  private readonly logger = new Logger(ErpService.name);
  private readonly file = join(dataDir(), 'erp', 'state.json');
  private state: ErpState = this.load();

  list(queue?: ErpQueue): ErpInvoiceSummary[] {
    return INVOICES.filter((inv) => !queue || inv.queue === queue).map((inv) => {
      const { draft, status } = this.state[inv.id];
      const supplier = supplierOf(inv);
      return {
        id: inv.id,
        queue: inv.queue,
        supplier: { id: supplier.id, name: supplier.name, known: supplier.known },
        description: inv.lines[0]?.description ?? '',
        amount: inv.amount,
        currency: inv.currency,
        dueDate: inv.dueDate,
        costCenter: draft.costCenter,
        status,
        routeTo: status === 'routed' ? draft.routeTo : undefined,
      };
    });
  }

  getDetail(id: string): ErpInvoiceDetail {
    const invoice = this.invoice(id);
    const { draft, status, processedAt } = this.state[invoice.id];
    return {
      invoice,
      supplier: supplierOf(invoice),
      draft: { ...draft },
      status,
      processedAt,
      history: [...(SUPPLIER_HISTORY[invoice.supplierId] ?? [])].sort((a, b) => b.date.localeCompare(a.date)),
      costCenters: COST_CENTERS,
    };
  }

  /** What guardrail rules (JSONLogic) are evaluated against. */
  getContext(id: string): ErpContext {
    const invoice = this.invoice(id);
    const s = supplierOf(invoice);
    return {
      invoice: {
        id: invoice.id,
        amount: invoice.amount,
        currency: invoice.currency,
        category: invoice.category,
        month: invoice.month,
        supplier: { id: s.id, name: s.name, country: s.country, known: s.known, isSubsidiary: s.isSubsidiary },
        poAssetNumber: invoice.poAssetNumber,
      },
      draft: { ...this.state[invoice.id].draft },
    };
  }

  patchDraft(id: string, body: unknown): InvoiceDraft {
    const invoice = this.invoice(id);
    const entry = this.openEntry(invoice);
    const patch = parseDraftPatch(body);
    for (const key of Object.keys(patch) as (keyof DraftPatch)[]) {
      const value = patch[key];
      if (value === undefined) delete entry.draft[key];
      else Object.assign(entry.draft, { [key]: value });
    }
    this.persist();
    return { ...entry.draft };
  }

  /**
   * The ErpContext as it would be saved with this action (draft.action/routeTo/comment applied),
   * validated like applyAction but without saving: what the save gate evaluates.
   */
  previewAction(id: string, body: unknown): ErpContext {
    const invoice = this.invoice(id);
    const { draft } = this.validatedAction(invoice, body);
    return { ...this.getContext(invoice.id), draft };
  }

  applyAction(id: string, body: unknown): ErpInvoiceDetail {
    const invoice = this.invoice(id);
    const { entry, req, draft } = this.validatedAction(invoice, body);
    entry.draft = draft;
    entry.status = STATUS_AFTER[req.action];
    entry.processedAt = new Date().toISOString();
    this.persist();
    this.logger.log(`${invoice.id}: ${req.action}${req.routeTo ? ` → ${req.routeTo}` : ''} (cost center ${entry.draft.costCenter})`);
    return this.getDetail(invoice.id);
  }

  reset(): void {
    this.state = seedState();
    this.persist();
    this.logger.log('ERP reset to seed state');
  }

  private validatedAction(invoice: Invoice, body: unknown) {
    const entry = this.openEntry(invoice);
    const req = parseActionRequest(body);
    const comment = (req.comment ?? entry.draft.comment ?? '').trim();
    if (req.action === 'hold' && !comment) {
      throw new BadRequestException('Add a comment before putting the invoice on hold.');
    }
    if (req.action === 'route' && !req.routeTo) {
      throw new BadRequestException('Choose where to route the invoice: controller or intercompany.');
    }
    const draft: InvoiceDraft = {
      ...entry.draft,
      action: req.action,
      routeTo: req.action === 'route' ? req.routeTo : undefined,
      comment: comment || undefined,
    };
    return { entry, req, draft };
  }

  private invoice(id: string): Invoice {
    const invoice = INVOICES.find((inv) => inv.id === id.toUpperCase());
    if (!invoice) throw new NotFoundException(`Invoice ${id} not found`);
    return invoice;
  }

  private openEntry(invoice: Invoice): InvoiceState {
    const entry = this.state[invoice.id];
    if (entry.status !== 'open') {
      throw new ConflictException(`${invoice.id} is already ${entry.status.replace('_', ' ')} and can't be changed.`);
    }
    return entry;
  }

  private load(): ErpState {
    const seeded = seedState();
    if (!existsSync(this.file)) return seeded;
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<ErpState>;
      // Seed invoices are the source of truth; keep saved state only for invoices that still exist.
      for (const id of Object.keys(seeded)) {
        const s = saved[id];
        if (s?.draft?.costCenter && s.status) seeded[id] = s;
      }
    } catch (err) {
      this.logger.warn(`Ignoring unreadable ${this.file}: ${(err as Error).message}`);
    }
    return seeded;
  }

  private persist(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.state, null, 2));
    renameSync(`${this.file}.tmp`, this.file);
  }
}

function seedState(): ErpState {
  return Object.fromEntries(INVOICES.map((inv) => [inv.id, { draft: initialDraft(inv), status: 'open' as const }]));
}

function supplierOf(invoice: Invoice) {
  const supplier = SUPPLIERS.find((s) => s.id === invoice.supplierId);
  if (!supplier) throw new Error(`Seed error: no supplier ${invoice.supplierId}`);
  return supplier;
}

// --- request parsing -------------------------------------------------------

function asObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('Expected a JSON object body');
  }
  return body as Record<string, unknown>;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T;
  throw new BadRequestException(`${field} must be one of: ${allowed.join(', ')}`);
}

/** '' or null clears the field (→ undefined). */
function optionalText(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value !== 'string') throw new BadRequestException(`${field} must be a string`);
  if (value.length > maxLength) throw new BadRequestException(`${field} is longer than ${maxLength} characters`);
  return value;
}

function parseDraftPatch(body: unknown): DraftPatch {
  const b = asObject(body);
  const patch: DraftPatch = {};
  if ('costCenter' in b) {
    patch.costCenter = oneOf(b.costCenter, COST_CENTERS.map((c) => c.code), 'costCenter');
  }
  if ('assetNumber' in b) patch.assetNumber = optionalText(b.assetNumber, 'assetNumber', 40)?.trim() || undefined;
  if ('comment' in b) patch.comment = optionalText(b.comment, 'comment', 1000);
  if ('routeTo' in b) {
    patch.routeTo = b.routeTo === null || b.routeTo === '' ? undefined : oneOf(b.routeTo, ROUTE_TARGETS, 'routeTo');
  }
  return patch;
}

function parseActionRequest(body: unknown): ErpActionRequest {
  const b = asObject(body);
  return {
    action: oneOf(b.action, ACTIONS, 'action'),
    routeTo: b.routeTo === undefined || b.routeTo === null ? undefined : oneOf(b.routeTo, ROUTE_TARGETS, 'routeTo'),
    comment: optionalText(b.comment, 'comment', 1000),
  };
}
