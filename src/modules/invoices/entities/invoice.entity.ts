import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Invoice, InvoiceItem, InvoiceStatus } from '@prisma/client';
import { InvoiceItemEntity } from './invoice-item.entity';

/** An invoice model that may carry its included line items. */
type InvoiceWithItems = Invoice & { items?: InvoiceItem[] };

/**
 * API-facing representation of an invoice. Build instances via `fromModel` so
 * the response shape stays decoupled from Prisma. Prisma `Decimal` money fields
 * are exposed as plain numbers.
 */
export class InvoiceEntity {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'INV-2026-0001' })
  number: string;

  @ApiProperty({ format: 'uuid' })
  customerId: string;

  @ApiProperty({
    enum: InvoiceStatus,
    example: InvoiceStatus.DRAFT,
    description: 'The stored lifecycle status. Never derived.',
  })
  status: InvoiceStatus;

  @ApiProperty({
    enum: InvoiceStatus,
    example: InvoiceStatus.DRAFT,
    description:
      'Status to display: equals `status`, except a SENT invoice past its ' +
      'dueDate is reported as OVERDUE. Derived on read; never persisted.',
  })
  displayStatus: InvoiceStatus;

  @ApiProperty()
  issueDate: Date;

  @ApiPropertyOptional({ nullable: true })
  dueDate: Date | null;

  @ApiProperty({ nullable: true, example: 'Payment due within 30 days.' })
  notes: string | null;

  @ApiProperty({ example: 11, description: 'Tax rate percentage.' })
  taxRate: number;

  @ApiProperty({ example: 301 })
  subtotal: number;

  @ApiProperty({ example: 33.11 })
  taxAmount: number;

  @ApiProperty({ example: 334.11 })
  total: number;

  @ApiProperty({ type: [InvoiceItemEntity] })
  items: InvoiceItemEntity[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  /**
   * Maps a Prisma invoice to its API shape. `displayStatus` defaults to the
   * stored `status`; callers that want the derived OVERDUE view pass the result
   * of `deriveDisplayStatus(invoice)` so reads surface it without mutating data.
   */
  static fromModel(
    invoice: InvoiceWithItems,
    displayStatus: InvoiceStatus = invoice.status,
  ): InvoiceEntity {
    const entity = new InvoiceEntity();
    entity.id = invoice.id;
    entity.number = invoice.number;
    entity.customerId = invoice.customerId;
    entity.status = invoice.status;
    entity.displayStatus = displayStatus;
    entity.issueDate = invoice.issueDate;
    entity.dueDate = invoice.dueDate;
    entity.notes = invoice.notes;
    entity.taxRate = Number(invoice.taxRate);
    entity.subtotal = Number(invoice.subtotal);
    entity.taxAmount = Number(invoice.taxAmount);
    entity.total = Number(invoice.total);
    entity.items = (invoice.items ?? []).map((item) =>
      InvoiceItemEntity.fromModel(item),
    );
    entity.createdAt = invoice.createdAt;
    entity.updatedAt = invoice.updatedAt;
    return entity;
  }
}
