import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InvoicesService } from './invoices.service';

/**
 * HTTP surface for the invoice domain. Kept intentionally minimal — this is the
 * foundation; listing, item mutations, status transitions and events arrive in
 * later plans.
 */
@ApiTags('Invoices')
@ApiBearerAuth()
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post()
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({
    summary: 'Create an invoice with inline items (admin/manager only)',
  })
  create(@Body() dto: CreateInvoiceDto, @CurrentUser('id') userId: string) {
    return this.invoicesService.create(dto, userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an invoice by id (with items)' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoicesService.findById(id);
  }
}
