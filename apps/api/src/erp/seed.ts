import type { CostCenter, Invoice, InvoiceDraft, Supplier, SupplierHistoryEntry } from '@apprentice/shared';

// Sandbox setting (BUILD_PLAN §5): period December 2026, "today" is Thu 10 Dec 2026.

export const COST_CENTERS: CostCenter[] = [
  { code: '4711', name: 'Maintenance & Repairs', type: 'opex' },
  { code: '4720', name: 'Office & Consumables', type: 'opex' },
  { code: '0400', name: 'Capital Equipment', type: 'capex' }, // needs an asset number (tacit; not enforced by the ERP)
];

export const SUPPLIERS: Supplier[] = [
  { id: 'V-10233', name: 'Kessler Maschinenteile GmbH', country: 'DE', city: 'Stuttgart', known: true, isSubsidiary: false, vendorSince: '2009-03-02' },
  { id: 'V-10417', name: 'Brandt Industriebedarf GmbH', country: 'DE', city: 'Hannover', known: true, isSubsidiary: false, vendorSince: '2012-06-18' },
  { id: 'V-20031', name: 'Moravia Components s.r.o.', country: 'CZ', city: 'Brno', known: true, isSubsidiary: true, vendorSince: '2016-01-04' },
  { id: 'V-10588', name: 'Büro Schmid KG', country: 'DE', city: 'Augsburg', known: true, isSubsidiary: false, vendorSince: '2014-09-22' },
  // Not in the vendor master: provisional id only.
  { id: 'TMP-0091', name: 'Feldmann Antriebstechnik GmbH', country: 'DE', city: 'Kassel', known: false, isSubsidiary: false },
];

export const INVOICES: Invoice[] = [
  // --- Sabine's queue (/erp?queue=expert) ---
  {
    id: 'INV-4471', queue: 'expert', supplierId: 'V-10233',
    invoiceDate: '2026-12-03', dueDate: '2027-01-02', month: 12, category: 'equipment',
    amount: 6840.0, currency: 'EUR', poNumber: '7781', poAssetNumber: 'AN-20417', defaultCostCenter: '4711',
    lines: [{ description: 'CNC spindle motor SM-220', quantity: 1, unit: 'pc', unitPrice: 6840.0, amount: 6840.0, poNumber: '7781', assetNumber: 'AN-20417' }],
  },
  {
    id: 'INV-4472', queue: 'expert', supplierId: 'V-10417',
    invoiceDate: '2026-12-07', dueDate: '2027-01-06', month: 12, category: 'consumables',
    amount: 1264.5, currency: 'EUR', defaultCostCenter: '4720',
    lines: [{ description: 'Hydraulic oil HLP 46, 200 L', quantity: 1, unit: 'drum', unitPrice: 1264.5, amount: 1264.5 }],
  },
  {
    id: 'INV-4473', queue: 'expert', supplierId: 'V-20031',
    invoiceDate: '2026-12-04', dueDate: '2027-01-03', month: 12, category: 'consumables',
    amount: 3980.0, currency: 'EUR', defaultCostCenter: '4711',
    lines: [{ description: 'Machined housings, batch 12', quantity: 40, unit: 'pc', unitPrice: 99.5, amount: 3980.0 }],
  },
  {
    id: 'INV-4474', queue: 'expert', supplierId: 'V-10588',
    invoiceDate: '2026-12-08', dueDate: '2026-12-22', month: 12, category: 'consumables',
    amount: 184.2, currency: 'EUR', defaultCostCenter: '4720',
    lines: [{ description: 'Printer toner, black', quantity: 2, unit: 'pc', unitPrice: 92.1, amount: 184.2 }],
  },

  // --- Lena's queue (/erp?queue=trainee): cases Sabine never showed ---
  {
    id: 'INV-5102', queue: 'trainee', supplierId: 'V-10233',
    invoiceDate: '2026-12-08', dueDate: '2027-01-07', month: 12, category: 'equipment',
    amount: 7200.0, currency: 'EUR', poNumber: '7840', poAssetNumber: 'AN-20488', defaultCostCenter: '4711',
    lines: [{ description: 'Press brake tooling set PT-90', quantity: 1, unit: 'set', unitPrice: 7200.0, amount: 7200.0, poNumber: '7840', assetNumber: 'AN-20488' }],
  },
  {
    id: 'INV-5103', queue: 'trainee', supplierId: 'TMP-0091',
    invoiceDate: '2026-12-07', dueDate: '2026-12-21', month: 12, category: 'equipment',
    amount: 2150.0, currency: 'EUR', defaultCostCenter: '4711',
    lines: [{ description: 'Gear motor GM-150, 1.5 kW', quantity: 1, unit: 'pc', unitPrice: 2150.0, amount: 2150.0 }],
  },
  {
    id: 'INV-5104', queue: 'trainee', supplierId: 'V-20031',
    invoiceDate: '2026-12-08', dueDate: '2027-01-07', month: 12, category: 'consumables',
    amount: 1120.0, currency: 'EUR', defaultCostCenter: '4711',
    lines: [{ description: 'Machined housings, batch 13', quantity: 10, unit: 'pc', unitPrice: 112.0, amount: 1120.0 }],
  },
  {
    id: 'INV-5105', queue: 'trainee', supplierId: 'V-10233',
    invoiceDate: '2026-12-09', dueDate: '2027-01-08', month: 12, category: 'equipment',
    amount: 4950.0, currency: 'EUR', defaultCostCenter: '4711',
    lines: [{ description: 'Spare bearing kit, spindle SB-6', quantity: 1, unit: 'kit', unitPrice: 4950.0, amount: 4950.0 }],
  },
];

export const SUPPLIER_HISTORY: Record<string, SupplierHistoryEntry[]> = {
  'V-10233': [
    { date: '2026-11-18', documentId: 'INV-4402', type: 'invoice', description: 'Coolant pump CP-40 repair kit', amount: 1420.0, costCenter: '4711', status: 'paid' },
    { date: '2026-09-02', documentId: 'INV-4351', type: 'invoice', description: 'Linear guide rail set', amount: 2980.0, costCenter: '4711', status: 'paid' },
    { date: '2026-05-15', documentId: 'INV-4210', type: 'invoice', description: 'CNC lathe chuck LC-315 · Asset AN-20311', amount: 8450.0, costCenter: '0400', status: 'paid' },
    { date: '2026-02-10', documentId: 'INV-4067', type: 'invoice', description: 'Spindle bearings, set of 4', amount: 3150.0, costCenter: '4711', status: 'paid' },
  ],
  // Last December: the same delivery billed twice, the second one credited in January.
  'V-10417': [
    { date: '2026-09-22', documentId: 'INV-4388', type: 'invoice', description: 'Hydraulic oil HLP 46, 200 L', amount: 1264.5, costCenter: '4720', status: 'paid' },
    { date: '2026-06-16', documentId: 'INV-4290', type: 'invoice', description: 'Hydraulic oil HLP 46, 200 L', amount: 1264.5, costCenter: '4720', status: 'paid' },
    { date: '2026-03-05', documentId: 'INV-4105', type: 'invoice', description: 'Hydraulic oil HLP 46, 200 L', amount: 1231.8, costCenter: '4720', status: 'paid' },
    { date: '2026-01-19', documentId: 'CN-0112', type: 'credit_note', description: 'Credit note for INV-3922 (duplicate)', amount: -1231.8, costCenter: '4720', status: 'applied' },
    { date: '2025-12-11', documentId: 'INV-3922', type: 'invoice', description: 'Hydraulic oil HLP 46, 200 L', amount: 1231.8, costCenter: '4720', status: 'credited' },
    { date: '2025-12-08', documentId: 'INV-3921', type: 'invoice', description: 'Hydraulic oil HLP 46, 200 L', amount: 1231.8, costCenter: '4720', status: 'paid' },
    { date: '2025-10-14', documentId: 'INV-3790', type: 'invoice', description: 'Hydraulic oil HLP 46, 200 L', amount: 1198.0, costCenter: '4720', status: 'paid' },
  ],
  'V-20031': [
    { date: '2026-11-12', documentId: 'INV-4398', type: 'invoice', description: 'Machined housings, batch 11', amount: 3860.0, costCenter: '4711', status: 'paid' },
    { date: '2026-10-08', documentId: 'INV-4371', type: 'invoice', description: 'Machined housings, batch 10', amount: 3720.0, costCenter: '4711', status: 'paid' },
    { date: '2026-09-03', documentId: 'INV-4340', type: 'invoice', description: 'Machined housings, batch 9', amount: 3910.0, costCenter: '4711', status: 'paid' },
  ],
  'V-10588': [
    { date: '2026-11-24', documentId: 'INV-4411', type: 'invoice', description: 'Copy paper A4, 10 boxes', amount: 238.0, costCenter: '4720', status: 'paid' },
    { date: '2026-10-13', documentId: 'INV-4377', type: 'invoice', description: 'Printer toner, black', amount: 184.2, costCenter: '4720', status: 'paid' },
    { date: '2026-08-19', documentId: 'INV-4322', type: 'invoice', description: 'Office chairs, 2 pcs', amount: 612.0, costCenter: '4720', status: 'paid' },
  ],
  'TMP-0091': [],
};

export function initialDraft(invoice: Invoice): InvoiceDraft {
  return { costCenter: invoice.defaultCostCenter };
}
