import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { CreateInvoiceItemDto } from './dto/create-invoice-item.dto';
import { UpdateInvoiceItemDto } from './dto/update-invoice-item.dto';
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

  @Post(':id/items')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({
    summary:
      'Add a line item to an editable invoice (admin/manager only); ' +
      'recomputes totals. 409 when the invoice is not editable.',
  })
  addItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateInvoiceItemDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.invoicesService.addItem(id, dto, userId);
  }

  @Patch(':id/items/:itemId')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({
    summary:
      'Update a line item on an editable invoice (admin/manager only); ' +
      'recomputes totals. 409 when the invoice is not editable.',
  })
  updateItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateInvoiceItemDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.invoicesService.updateItem(id, itemId, dto, userId);
  }

  @Delete(':id/items/:itemId')
  @Roles(Role.ADMIN, Role.MANAGER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Remove a line item from an editable invoice (admin/manager only); ' +
      'recomputes totals. 409 when the invoice is not editable.',
  })
  removeItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.invoicesService.removeItem(id, itemId, userId);
  }
}
