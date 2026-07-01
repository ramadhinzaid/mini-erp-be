import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsPositive, IsString, MaxLength } from 'class-validator';

/**
 * A single line item supplied inline when creating an invoice. `lineTotal` is
 * derived server-side (`quantity` * `unitPrice`) and is never accepted here.
 */
export class CreateInvoiceItemDto {
  @ApiProperty({ example: 'Consulting services' })
  @IsString()
  @MaxLength(500)
  description: string;

  @ApiProperty({ example: 2, description: 'Positive quantity (up to 2 dp).' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  quantity: number;

  @ApiProperty({
    example: 150.5,
    description: 'Positive unit price (up to 2 dp).',
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  unitPrice: number;
}
