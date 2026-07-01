import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from 'src/common/dto/pagination-query.dto';

/**
 * Pagination plus an optional free-text `search` filter applied to a
 * customer's name, email and company (case-insensitive).
 */
export class QueryCustomersDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Case-insensitive search on name, email or company',
    example: 'acme',
  })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  search?: string;
}
