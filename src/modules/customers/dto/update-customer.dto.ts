import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateCustomerDto } from './create-customer.dto';

/**
 * All create fields become optional; `isActive` is added so managers can
 * activate/deactivate a customer record.
 */
export class UpdateCustomerDto extends PartialType(CreateCustomerDto) {
  @ApiPropertyOptional({ description: 'Whether the customer is active' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
