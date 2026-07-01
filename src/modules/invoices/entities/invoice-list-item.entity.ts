import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Invoice, InvoiceStatus } from '@prisma/client';

/** The trimmed customer projection carried alongside a listed invoice. */
export class InvoiceListCustomer {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Acme Corp' })
  name: string;
}

/** An invoice model carrying the selected `customer` (id + name) projection. */
type InvoiceWithCustomer = Invoice & {
  customer?: { id: string; name: string } | null;
};

/**
 * API-facing representation of an invoice in a list. Line items are omitted for
 * a lean payload; the owning customer is projected to `{ id, name }` and the
 * derived `displayStatus` surfaces `OVERDUE` without mutating the stored status.
 */
export class InvoiceListItemEntity {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'INV-2026-0001' })
  number: string;

  @ApiProperty({ format: 'uuid' })
  customerId: string;

  @ApiPropertyOptional({ type: InvoiceListCustomer, nullable: true })
  customer: InvoiceListCustomer | null;

  @ApiProperty({
    enum: InvoiceStatus,
    description: 'The status persisted on the invoice.',
    example: InvoiceStatus.SENT,
  })
  status: InvoiceStatus;

  @ApiProperty({
    enum: InvoiceStatus,
    description:
      'The status shown to the user, derived from the due date (SENT past its due date becomes OVERDUE).',
    example: InvoiceStatus.OVERDUE,
  })
  displayStatus: InvoiceStatus;

  @ApiProperty()
  issueDate: Date;

  @ApiPropertyOptional({ nullable: true })
  dueDate: Date | null;

  @ApiProperty({ example: 11, description: 'Tax rate percentage.' })
  taxRate: number;

  @ApiProperty({ example: 331 })
  subtotal: number;

  @ApiProperty({ example: 36.41 })
  taxAmount: number;

  @ApiProperty({ example: 367.41 })
  total: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  static fromModel(
    invoice: InvoiceWithCustomer,
    displayStatus: InvoiceStatus,
  ): InvoiceListItemEntity {
    const entity = new InvoiceListItemEntity();
    entity.id = invoice.id;
    entity.number = invoice.number;
    entity.customerId = invoice.customerId;
    entity.customer = invoice.customer
      ? { id: invoice.customer.id, name: invoice.customer.name }
      : null;
    entity.status = invoice.status;
    entity.displayStatus = displayStatus;
    entity.issueDate = invoice.issueDate;
    entity.dueDate = invoice.dueDate;
    entity.taxRate = Number(invoice.taxRate);
    entity.subtotal = Number(invoice.subtotal);
    entity.taxAmount = Number(invoice.taxAmount);
    entity.total = Number(invoice.total);
    entity.createdAt = invoice.createdAt;
    entity.updatedAt = invoice.updatedAt;
    return entity;
  }
}
