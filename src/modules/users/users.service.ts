import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PaginatedResult } from 'src/common/dto/paginated-result';
import { PaginationQueryDto } from 'src/common/dto/pagination-query.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserEntity } from './entities/user.entity';

const BCRYPT_SALT_ROUNDS = 10;

/**
 * Owns all business rules and persistence for users. Controllers stay thin and
 * delegate here; auth depends on this service for credential lookups. This is
 * the seam that would become a "users" microservice with no behavioural change.
 */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateUserDto): Promise<UserEntity> {
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_SALT_ROUNDS);

    try {
      const user = await this.prisma.user.create({
        data: { ...dto, password: passwordHash },
      });
      return UserEntity.fromModel(user);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('A user with this email already exists');
      }
      throw error;
    }
  }

  async findAll(
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<UserEntity>> {
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        skip: query.skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count(),
    ]);

    return new PaginatedResult(
      users.map((user) => UserEntity.fromModel(user)),
      total,
      query.page,
      query.limit,
    );
  }

  async findById(id: string): Promise<UserEntity> {
    return UserEntity.fromModel(await this.getOrThrow(id));
  }

  /**
   * Returns the raw model including the password hash. Intended for the auth
   * module only — never expose the result directly through the API.
   */
  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserEntity> {
    await this.getOrThrow(id);

    const data: Prisma.UserUpdateInput = { ...dto };
    if (dto.password) {
      data.password = await bcrypt.hash(dto.password, BCRYPT_SALT_ROUNDS);
    }

    const user = await this.prisma.user.update({ where: { id }, data });
    return UserEntity.fromModel(user);
  }

  async remove(id: string): Promise<void> {
    await this.getOrThrow(id);
    await this.prisma.user.delete({ where: { id } });
  }

  private async getOrThrow(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return user;
  }
}
