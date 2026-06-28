import { OmitType, PartialType } from '@nestjs/swagger';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateUserDto } from './create-user.dto';

/**
 * All create fields become optional; `isActive` is added so admins can
 * activate/deactivate accounts.
 */
export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, ['email'] as const),
) {
  @ApiPropertyOptional({ description: 'Whether the account is active' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
