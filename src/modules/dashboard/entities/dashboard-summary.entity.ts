import { ApiProperty } from '@nestjs/swagger';
import { InvoiceStatus } from '@prisma/client';

/**
 * Number of invoices in each display bucket. `OVERDUE` is a *derived* bucket:
 * it counts `SENT` invoices whose `dueDate` has passed (there is no separate
 * persisted OVERDUE lifecycle in the create-invoice foundation), plus any rows
 * that already carry the `OVERDUE` status. Buckets are always present and
 * default to `0`, even on an empty database.
 */
export class InvoiceStatusCountsEntity {
  @ApiProperty({ example: 3, description: 'Invoices still in DRAFT.' })
  DRAFT: number;

  @ApiProperty({
    example: 5,
    description: 'Sent invoices that are not yet past their due date.',
  })
  SENT: number;

  @ApiProperty({ example: 10, description: 'Invoices marked as PAID.' })
  PAID: number;

  @ApiProperty({ example: 1, description: 'Voided invoices.' })
  VOID: number;

  @ApiProperty({
    example: 2,
    description:
      'Sent invoices past their due date (derived) plus any persisted OVERDUE rows.',
  })
  OVERDUE: number;
}

/** A compact invoice row for the dashboard's "recent activity" list. */
export class RecentInvoiceEntity {
  @ApiProperty({
    example: '3f1c2d4e-5a6b-7c8d-9e0f-1a2b3c4d5e6f',
    description: 'Invoice id — used to link through to the invoice detail.',
  })
  id: string;

  @ApiProperty({ example: 'INV-2026-0007' })
  number: string;

  @ApiProperty({ example: 'Acme Corporation' })
  customerName: string;

  @ApiProperty({ example: 367.41, description: 'Invoice grand total.' })
  total: number;

  @ApiProperty({
    enum: InvoiceStatus,
    example: InvoiceStatus.OVERDUE,
    description:
      'Display status — SENT invoices past due are shown as OVERDUE.',
  })
  status: InvoiceStatus;

  @ApiProperty()
  issueDate: Date;
}

/**
 * Aggregated KPIs for the dashboard, computed from invoice and customer data.
 * All money fields follow the invoice convention: Prisma `Decimal` values are
 * exposed as plain numbers.
 */
export class DashboardSummaryEntity {
  @ApiProperty({
    example: 12500.5,
    description: 'Total value (Σ total) of PAID invoices.',
  })
  revenue: number;

  @ApiProperty({
    example: 3400,
    description:
      'Total value (Σ total) of outstanding invoices — SENT (including derived OVERDUE) and any persisted OVERDUE.',
  })
  outstanding: number;

  @ApiProperty({ type: InvoiceStatusCountsEntity })
  invoiceCounts: InvoiceStatusCountsEntity;

  @ApiProperty({ example: 42, description: 'Number of active customers.' })
  customerCount: number;

  @ApiProperty({ type: [RecentInvoiceEntity] })
  recentInvoices: RecentInvoiceEntity[];
}
