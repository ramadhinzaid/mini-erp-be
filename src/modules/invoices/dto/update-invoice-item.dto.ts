import { PartialType } from '@nestjs/swagger';
import { CreateInvoiceItemDto } from './create-invoice-item.dto';

/**
 * Payload for updating a single invoice line item. Every field is optional so a
 * caller may change only `description`, `quantity` and/or `unitPrice`; the
 * validation rules (positive `quantity`/`unitPrice`, bounded `description`) are
 * inherited from {@link CreateInvoiceItemDto}. `lineTotal` remains server-derived.
 */
export class UpdateInvoiceItemDto extends PartialType(CreateInvoiceItemDto) {}
