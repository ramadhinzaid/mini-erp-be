import { ApiProperty } from '@nestjs/swagger';
import { Role, User } from '@prisma/client';

/**
 * API-facing representation of a user. Deliberately omits the password hash so
 * it can never be serialized into a response. Build instances via the static
 * `fromModel` factory.
 */
export class UserEntity {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'jane.doe@example.com' })
  email: string;

  @ApiProperty({ nullable: true, example: 'Jane' })
  firstName: string | null;

  @ApiProperty({ nullable: true, example: 'Doe' })
  lastName: string | null;

  @ApiProperty({ enum: Role })
  role: Role;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  static fromModel(user: User): UserEntity {
    const entity = new UserEntity();
    entity.id = user.id;
    entity.email = user.email;
    entity.firstName = user.firstName;
    entity.lastName = user.lastName;
    entity.role = user.role;
    entity.isActive = user.isActive;
    entity.createdAt = user.createdAt;
    entity.updatedAt = user.updatedAt;
    return entity;
  }
}
