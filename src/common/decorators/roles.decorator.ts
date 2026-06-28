import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * Restricts a route to the given roles. Enforced by `RolesGuard`.
 * Example: `@Roles(Role.ADMIN, Role.MANAGER)`.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
