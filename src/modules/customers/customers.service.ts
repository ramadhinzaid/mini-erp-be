import { Injectable, NotFoundException } from '@nestjs/common';
import { Customer, Prisma } from '@prisma/client';
import { PaginatedResult } from 'src/common/dto/paginated-result';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { QueryCustomersDto } from './dto/query-customers.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CustomerEntity } from './entities/customer.entity';

/**
 * Owns all business rules and persistence for customers. Controllers stay thin
 * and delegate here. This is the seam that would become a "customers"
 * microservice with no behavioural change.
 */
@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCustomerDto): Promise<CustomerEntity> {
    const customer = await this.prisma.customer.create({ data: { ...dto } });
    return CustomerEntity.fromModel(customer);
  }

  async findAll(
    query: QueryCustomersDto,
  ): Promise<PaginatedResult<CustomerEntity>> {
    const where = this.buildWhere(query.search);

    const [customers, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.customer.count({ where }),
    ]);

    return new PaginatedResult(
      customers.map((customer) => CustomerEntity.fromModel(customer)),
      total,
      query.page,
      query.limit,
    );
  }

  async findById(id: string): Promise<CustomerEntity> {
    return CustomerEntity.fromModel(await this.getOrThrow(id));
  }

  async update(id: string, dto: UpdateCustomerDto): Promise<CustomerEntity> {
    await this.getOrThrow(id);
    const customer = await this.prisma.customer.update({
      where: { id },
      data: { ...dto },
    });
    return CustomerEntity.fromModel(customer);
  }

  async remove(id: string): Promise<void> {
    await this.getOrThrow(id);
    await this.prisma.customer.delete({ where: { id } });
  }

  /** Builds the optional case-insensitive search filter over name/email/company. */
  private buildWhere(search?: string): Prisma.CustomerWhereInput | undefined {
    if (!search) {
      return undefined;
    }

    const contains = { contains: search, mode: 'insensitive' as const };
    return {
      OR: [{ name: contains }, { email: contains }, { company: contains }],
    };
  }

  private async getOrThrow(id: string): Promise<Customer> {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) {
      throw new NotFoundException(`Customer ${id} not found`);
    }
    return customer;
  }
}
