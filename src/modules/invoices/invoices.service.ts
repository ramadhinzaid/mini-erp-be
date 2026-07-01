import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceEventType, InvoiceStatus, Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { CreateInvoiceItemDto } from './dto/create-invoice-item.dto';
import { UpdateInvoiceItemDto } from './dto/update-invoice-item.dto';
import { InvoiceEntity } from './entities/invoice.entity';

/** A quantity/unit-price pair from which a line total is derived. */
export interface PricedLine {
  quantity: Prisma.Decimal.Value;
  unitPrice: Prisma.Decimal.Value;
}

/** Money totals derived from a set of priced lines and a tax rate. */
export interface InvoiceTotals {
  /** `quantity * unitPrice` per line, rounded to 2 dp, index-aligned to input. */
  lineTotals: Prisma.Decimal[];
  subtotal: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  total: Prisma.Decimal;
}

/** Data needed to append an audit event to an invoice. */
export interface InvoiceEventInput {
  type: InvoiceEventType;
  fromStatus?: Prisma.InvoiceEventCreateInput['fromStatus'];
  toStatus?: Prisma.InvoiceEventCreateInput['toStatus'];
  message?: string | null;
  actorUserId?: string | null;
}

/**
 * Recomputes an invoice's money totals from its line items and tax rate. Kept
 * pure and exported so later plans (add-item, update-item) can re-derive totals
 * without duplicating the rounding rules.
 *
 * - `lineTotal` = `quantity` * `unitPrice`, rounded to 2 dp
 * - `subtotal`  = Σ `lineTotal`
 * - `taxAmount` = round(`subtotal` * `taxRate` / 100, 2)
 * - `total`     = `subtotal` + `taxAmount`
 */
export function computeInvoiceTotals(
  lines: PricedLine[],
  taxRate: Prisma.Decimal.Value,
): InvoiceTotals {
  const lineTotals = lines.map((line) =>
    new Prisma.Decimal(line.quantity).mul(line.unitPrice).toDecimalPlaces(2),
  );

  const subtotal = lineTotals
    .reduce((acc, lineTotal) => acc.add(lineTotal), new Prisma.Decimal(0))
    .toDecimalPlaces(2);

  const taxAmount = subtotal.mul(taxRate).div(100).toDecimalPlaces(2);

  const total = subtotal.add(taxAmount).toDecimalPlaces(2);

  return { lineTotals, subtotal, taxAmount, total };
}

/**
 * Appends an audit event to an invoice within an existing transaction. Exported
 * for reuse by later plans (status changes, item edits) so every mutation logs
 * through a single seam.
 */
export function appendInvoiceEvent(
  tx: Prisma.TransactionClient,
  invoiceId: string,
  event: InvoiceEventInput,
): Promise<unknown> {
  return tx.invoiceEvent.create({
    data: {
      invoiceId,
      type: event.type,
      fromStatus: event.fromStatus ?? null,
      toStatus: event.toStatus ?? null,
      message: event.message ?? null,
      actorUserId: event.actorUserId ?? null,
    },
  });
}

/**
 * Statuses in which an invoice's line items may still be mutated. Adding,
 * updating or removing items on any other status (PAID/VOID/OVERDUE) is a
 * conflict — the invoice is considered locked.
 */
const EDITABLE_STATUSES: readonly InvoiceStatus[] = [
  InvoiceStatus.DRAFT,
  InvoiceStatus.SENT,
];

/**
 * Owns all business rules and persistence for invoices. This module is the
 * foundation for the wider invoice domain — later plans (add-items,
 * update-status, history, dashboard) extend this service.
 */
@Injectable()
export class InvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates an invoice with optional inline items in a single transaction:
   * generates the next per-year invoice number, computes line/subtotal/tax/
   * total money fields, and writes a CREATED audit event.
   */
  async create(
    dto: CreateInvoiceDto,
    actorUserId?: string,
  ): Promise<InvoiceEntity> {
    const issueDate = new Date();
    const lines = dto.items ?? [];
    const taxRate = new Prisma.Decimal(dto.taxRate ?? 0);
    const totals = computeInvoiceTotals(lines, taxRate);

    const invoice = await this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({
        where: { id: dto.customerId },
      });
      if (!customer) {
        throw new NotFoundException(`Customer ${dto.customerId} not found`);
      }

      const number = await this.generateNumber(tx, issueDate.getFullYear());

      const created = await tx.invoice.create({
        data: {
          number,
          customerId: dto.customerId,
          issueDate,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          notes: dto.notes ?? null,
          taxRate,
          subtotal: totals.subtotal,
          taxAmount: totals.taxAmount,
          total: totals.total,
          items: {
            create: lines.map((line, index) => ({
              description: line.description,
              quantity: new Prisma.Decimal(line.quantity),
              unitPrice: new Prisma.Decimal(line.unitPrice),
              lineTotal: totals.lineTotals[index],
            })),
          },
        },
        include: { items: true },
      });

      await appendInvoiceEvent(tx, created.id, {
        type: InvoiceEventType.CREATED,
        toStatus: created.status,
        message: `Invoice ${created.number} created`,
        actorUserId,
      });

      return created;
    });

    return InvoiceEntity.fromModel(invoice);
  }

  /** Returns an invoice with its line items, or throws NotFound. */
  async findById(id: string): Promise<InvoiceEntity> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!invoice) {
      throw new NotFoundException(`Invoice ${id} not found`);
    }
    return InvoiceEntity.fromModel(invoice);
  }

  /**
   * Adds a line item to an editable invoice in a single transaction: computes
   * the new line's `lineTotal`, recomputes the invoice's money totals, writes an
   * `ITEM_ADDED` audit event, and returns the updated invoice with its items.
   * 404 when the invoice is missing; 409 when it is not editable.
   */
  async addItem(
    invoiceId: string,
    dto: CreateInvoiceItemDto,
    actorUserId?: string,
  ): Promise<InvoiceEntity> {
    const invoice = await this.prisma.$transaction(async (tx) => {
      const existing = await this.loadEditableInvoice(tx, invoiceId);

      const lineTotal = new Prisma.Decimal(dto.quantity)
        .mul(dto.unitPrice)
        .toDecimalPlaces(2);

      await tx.invoiceItem.create({
        data: {
          invoiceId,
          description: dto.description,
          quantity: new Prisma.Decimal(dto.quantity),
          unitPrice: new Prisma.Decimal(dto.unitPrice),
          lineTotal,
        },
      });

      const updated = await this.recomputeTotals(
        tx,
        invoiceId,
        existing.taxRate,
      );

      await appendInvoiceEvent(tx, invoiceId, {
        type: InvoiceEventType.ITEM_ADDED,
        message: `Item "${dto.description}" added to ${existing.number}`,
        actorUserId,
      });

      return updated;
    });

    return InvoiceEntity.fromModel(invoice);
  }

  /**
   * Updates a line item on an editable invoice in a single transaction. Only the
   * supplied fields change; `lineTotal` is re-derived from the resulting
   * `quantity` * `unitPrice`. Recomputes invoice totals, writes an `ITEM_UPDATED`
   * audit event, and returns the updated invoice with its items. 404 when the
   * invoice or item is missing; 409 when the invoice is not editable.
   */
  async updateItem(
    invoiceId: string,
    itemId: string,
    dto: UpdateInvoiceItemDto,
    actorUserId?: string,
  ): Promise<InvoiceEntity> {
    const invoice = await this.prisma.$transaction(async (tx) => {
      const existing = await this.loadEditableInvoice(tx, invoiceId);
      const item = this.findItemOrThrow(existing, itemId);

      const quantity =
        dto.quantity !== undefined
          ? new Prisma.Decimal(dto.quantity)
          : item.quantity;
      const unitPrice =
        dto.unitPrice !== undefined
          ? new Prisma.Decimal(dto.unitPrice)
          : item.unitPrice;
      const lineTotal = quantity.mul(unitPrice).toDecimalPlaces(2);

      await tx.invoiceItem.update({
        where: { id: itemId },
        data: {
          description: dto.description ?? undefined,
          quantity,
          unitPrice,
          lineTotal,
        },
      });

      const updated = await this.recomputeTotals(
        tx,
        invoiceId,
        existing.taxRate,
      );

      await appendInvoiceEvent(tx, invoiceId, {
        type: InvoiceEventType.ITEM_UPDATED,
        message: `Item "${item.description}" updated on ${existing.number}`,
        actorUserId,
      });

      return updated;
    });

    return InvoiceEntity.fromModel(invoice);
  }

  /**
   * Removes a line item from an editable invoice in a single transaction:
   * recomputes the invoice's money totals and writes an `ITEM_REMOVED` audit
   * event. 404 when the invoice or item is missing; 409 when the invoice is not
   * editable.
   */
  async removeItem(
    invoiceId: string,
    itemId: string,
    actorUserId?: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await this.loadEditableInvoice(tx, invoiceId);
      const item = this.findItemOrThrow(existing, itemId);

      await tx.invoiceItem.delete({ where: { id: itemId } });

      await this.recomputeTotals(tx, invoiceId, existing.taxRate);

      await appendInvoiceEvent(tx, invoiceId, {
        type: InvoiceEventType.ITEM_REMOVED,
        message: `Item "${item.description}" removed from ${existing.number}`,
        actorUserId,
      });
    });
  }

  /**
   * Loads an invoice with its items for mutation, asserting it exists (404) and
   * is in an editable status (409). Runs inside the caller's transaction.
   */
  private async loadEditableInvoice(
    tx: Prisma.TransactionClient,
    invoiceId: string,
  ): Promise<Prisma.InvoiceGetPayload<{ include: { items: true } }>> {
    const invoice = await tx.invoice.findUnique({
      where: { id: invoiceId },
      include: { items: true },
    });
    if (!invoice) {
      throw new NotFoundException(`Invoice ${invoiceId} not found`);
    }
    if (!EDITABLE_STATUSES.includes(invoice.status)) {
      throw new ConflictException(
        `Invoice ${invoice.number} is ${invoice.status}; its items cannot be modified`,
      );
    }
    return invoice;
  }

  /** Finds a line item on the loaded invoice, or throws NotFound. */
  private findItemOrThrow(
    invoice: Prisma.InvoiceGetPayload<{ include: { items: true } }>,
    itemId: string,
  ): Prisma.InvoiceItemGetPayload<true> {
    const item = invoice.items.find((candidate) => candidate.id === itemId);
    if (!item) {
      throw new NotFoundException(
        `Item ${itemId} not found on invoice ${invoice.id}`,
      );
    }
    return item;
  }

  /**
   * Recomputes and persists an invoice's `subtotal`/`taxAmount`/`total` from its
   * current line items (via the shared {@link computeInvoiceTotals} helper) and
   * returns the refreshed invoice with items. Runs inside the caller's
   * transaction, after items have been added/updated/removed.
   */
  private async recomputeTotals(
    tx: Prisma.TransactionClient,
    invoiceId: string,
    taxRate: Prisma.Decimal,
  ): Promise<Prisma.InvoiceGetPayload<{ include: { items: true } }>> {
    const items = await tx.invoiceItem.findMany({ where: { invoiceId } });
    const totals = computeInvoiceTotals(items, taxRate);

    return tx.invoice.update({
      where: { id: invoiceId },
      data: {
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        total: totals.total,
      },
      include: { items: true },
    });
  }

  /**
   * Builds the next invoice number for a year: `INV-<year>-<seq>`, where `seq`
   * is the count of invoices already issued that year plus one, zero-padded to
   * four digits (e.g. `INV-2026-0001`).
   */
  private async generateNumber(
    tx: Prisma.TransactionClient,
    year: number,
  ): Promise<string> {
    const start = new Date(Date.UTC(year, 0, 1));
    const end = new Date(Date.UTC(year + 1, 0, 1));
    const issuedThisYear = await tx.invoice.count({
      where: { issueDate: { gte: start, lt: end } },
    });
    const sequence = String(issuedThisYear + 1).padStart(4, '0');
    return `INV-${year}-${sequence}`;
  }
}
