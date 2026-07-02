import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InvoiceEvent, InvoiceEventType, InvoiceStatus } from '@prisma/client';

/**
 * API-facing representation of a single audit-trail event on an invoice. The
 * actor's email is resolved by the service (there is no DB relation) and is
 * `null` for system-generated events or when the user no longer exists.
 */
export class InvoiceEventEntity {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  invoiceId: string;

  @ApiProperty({ enum: InvoiceEventType, example: InvoiceEventType.CREATED })
  type: InvoiceEventType;

  @ApiPropertyOptional({ enum: InvoiceStatus, nullable: true })
  fromStatus: InvoiceStatus | null;

  @ApiPropertyOptional({ enum: InvoiceStatus, nullable: true })
  toStatus: InvoiceStatus | null;

  @ApiProperty({ nullable: true, example: 'Invoice INV-2026-0001 created' })
  message: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  actorUserId: string | null;

  @ApiProperty({ nullable: true, example: 'admin@example.com' })
  actorEmail: string | null;

  @ApiProperty()
  createdAt: Date;

  static fromModel(
    event: InvoiceEvent,
    actorEmail: string | null = null,
  ): InvoiceEventEntity {
    const entity = new InvoiceEventEntity();
    entity.id = event.id;
    entity.invoiceId = event.invoiceId;
    entity.type = event.type;
    entity.fromStatus = event.fromStatus;
    entity.toStatus = event.toStatus;
    entity.message = event.message;
    entity.actorUserId = event.actorUserId;
    entity.actorEmail = actorEmail;
    entity.createdAt = event.createdAt;
    return entity;
  }
}
