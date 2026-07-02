import { ApiProperty } from '@nestjs/swagger';
import { InvoiceStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

/**
 * Payload for a manual invoice status transition. `status` is validated against
 * the {@link InvoiceStatus} enum; the service enforces the lifecycle matrix
 * (which transitions are legal), rejects a manually-supplied `OVERDUE` (that
 * state is derived, never set by clients) and restricts `VOID` to ADMIN.
 */
export class UpdateInvoiceStatusDto {
  @ApiProperty({
    enum: InvoiceStatus,
    example: InvoiceStatus.SENT,
    description:
      'Target status. Allowed manual transitions: DRAFT→SENT, DRAFT→VOID, ' +
      'SENT→PAID, SENT→VOID. PAID and VOID are terminal. OVERDUE is derived ' +
      'and cannot be set manually.',
  })
  @IsEnum(InvoiceStatus)
  status: InvoiceStatus;
}
