// Feature modules (Phase 1–2) registered here to keep app.module.ts readable.
import { LedgerService } from './modules/ledger/ledger.service';
import { DocumentRegistry } from './modules/approvals/documents';
import { ApprovalService } from './modules/approvals/approval.service';
import { ApprovalsController } from './modules/approvals/approvals.controller';
import { CoaController } from './modules/coa/coa.controller';
import { TaxController, TaxService } from './modules/tax/tax.controller';
import { ContactsController } from './modules/contacts/contacts.controller';
import { JournalsService } from './modules/journals/journals.service';
import { JournalsController } from './modules/journals/journals.controller';
import { CorrectionsController, CorrectionsService } from './modules/corrections/corrections.service';
import { OpeningController, OpeningService } from './modules/opening/opening.service';
import { ReportsService } from './modules/reports/reports.service';
import { ReportsController } from './modules/reports/reports.controller';
import { AllocationService } from './modules/allocations/allocation.service';
import { TradeDocsService } from './modules/sales/trade-docs.service';
import { MoneyDocsService } from './modules/sales/money-docs.service';
import { GrnService } from './modules/purchases/grn.service';
import { PrintController, PrintService } from './modules/print/print.service';
import * as T from './modules/sales/trade.controllers';

export const FEATURE_CONTROLLERS: any[] = [
  ApprovalsController,
  CoaController,
  TaxController,
  ContactsController,
  JournalsController,
  CorrectionsController,
  OpeningController,
  ReportsController,
  T.SalesQuotesController,
  T.SalesOrdersController,
  T.SalesInvoicesController,
  T.CreditNotesController,
  T.PurchaseOrdersController,
  T.BillsController,
  T.DebitNotesController,
  T.ExpensesController,
  T.ReceiptsController,
  T.PaymentsController,
  T.AdvanceAdjustmentsController,
  T.AllocationsController,
  T.GoodsReceiptsController,
  PrintController,
];
export const FEATURE_PROVIDERS: any[] = [
  LedgerService,
  DocumentRegistry,
  ApprovalService,
  TaxService,
  JournalsService,
  CorrectionsService,
  OpeningService,
  ReportsService,
  AllocationService,
  TradeDocsService,
  MoneyDocsService,
  GrnService,
  PrintService,
];
