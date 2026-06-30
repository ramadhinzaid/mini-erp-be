import { ApiProperty } from '@nestjs/swagger';
import { Customer } from '@prisma/client';

/**
 * API-facing representation of a customer. Build instances via the static
 * `fromModel` factory so the response shape stays decoupled from the Prisma
 * model.
 */
export class CustomerEntity {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Acme Corporation' })
  name: string;

  @ApiProperty({ nullable: true, example: 'contact@acme.example' })
  email: string | null;

  @ApiProperty({ nullable: true, example: '+1-202-555-0142' })
  phone: string | null;

  @ApiProperty({ nullable: true, example: 'Acme Corporation' })
  company: string | null;

  @ApiProperty({ nullable: true, example: '123 Market St, Springfield' })
  address: string | null;

  @ApiProperty({ nullable: true, example: 'Prefers email contact.' })
  notes: string | null;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  static fromModel(customer: Customer): CustomerEntity {
    const entity = new CustomerEntity();
    entity.id = customer.id;
    entity.name = customer.name;
    entity.email = customer.email;
    entity.phone = customer.phone;
    entity.company = customer.company;
    entity.address = customer.address;
    entity.notes = customer.notes;
    entity.isActive = customer.isActive;
    entity.createdAt = customer.createdAt;
    entity.updatedAt = customer.updatedAt;
    return entity;
  }
}
