import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { DashboardSummaryEntity } from './entities/dashboard-summary.entity';

/**
 * HTTP surface for the dashboard. Thin by design — all aggregation lives in
 * {@link DashboardService}. Readable by any authenticated user (the global
 * `JwtAuthGuard` applies; no `@Roles` restriction).
 */
@ApiTags('Dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  @ApiOperation({
    summary: 'Aggregated KPI summary (revenue, outstanding, counts, recents)',
  })
  @ApiOkResponse({ type: DashboardSummaryEntity })
  getSummary(): Promise<DashboardSummaryEntity> {
    return this.dashboardService.getSummary();
  }
}
