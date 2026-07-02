import { ApiPropertyOptional } from '@nestjs/swagger';
import { InvoiceStatus } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from 'src/common/dto/pagination-query.dto';

/**
 * Pagination plus the optional filters for the invoice list endpoint. Every
 * filter is independent and combined with AND; omitting one leaves it
 * unconstrained.
 */
export class QueryInvoicesDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: InvoiceStatus,
    description: 'Filter by the stored invoice status.',
    example: InvoiceStatus.SENT,
  })
  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Filter by the owning customer id.',
  })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({
    description: 'Case-insensitive search on the invoice number.',
    example: 'INV-2026',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  search?: string;

  @ApiPropertyOptional({
    description: 'Only invoices issued on or after this date (inclusive).',
    example: '2026-01-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  issuedFrom?: string;

  @ApiPropertyOptional({
    description: 'Only invoices issued on or before this date (inclusive).',
    example: '2026-12-31T23:59:59.999Z',
  })
  @IsOptional()
  @IsDateString()
  issuedTo?: string;
}
