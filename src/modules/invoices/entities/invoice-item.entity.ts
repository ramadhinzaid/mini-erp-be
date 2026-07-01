import { ApiProperty } from '@nestjs/swagger';
import { InvoiceItem } from '@prisma/client';

/**
 * API-facing representation of an invoice line item. Prisma `Decimal` money
 * fields are exposed as plain numbers for a clean JSON contract.
 */
export class InvoiceItemEntity {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  invoiceId: string;

  @ApiProperty({ example: 'Consulting services' })
  description: string;

  @ApiProperty({ example: 2 })
  quantity: number;

  @ApiProperty({ example: 150.5 })
  unitPrice: number;

  @ApiProperty({ example: 301 })
  lineTotal: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  static fromModel(item: InvoiceItem): InvoiceItemEntity {
    const entity = new InvoiceItemEntity();
    entity.id = item.id;
    entity.invoiceId = item.invoiceId;
    entity.description = item.description;
    entity.quantity = Number(item.quantity);
    entity.unitPrice = Number(item.unitPrice);
    entity.lineTotal = Number(item.lineTotal);
    entity.createdAt = item.createdAt;
    entity.updatedAt = item.updatedAt;
    return entity;
  }
}
