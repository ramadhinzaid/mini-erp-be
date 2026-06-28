import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { AuthenticatedUser } from '../types/authenticated-user';
import { RolesGuard } from './roles.guard';

const contextWith = (user?: AuthenticatedUser): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  }) as unknown as ExecutionContext;

describe('RolesGuard', () => {
  let reflector: Reflector;
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('allows routes without required roles', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(contextWith())).toBe(true);
  });

  it('allows a user whose role is permitted', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);
    const user: AuthenticatedUser = {
      id: '1',
      email: 'a@b.c',
      role: Role.ADMIN,
    };
    expect(guard.canActivate(contextWith(user))).toBe(true);
  });

  it('forbids a user whose role is not permitted', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);
    const user: AuthenticatedUser = {
      id: '1',
      email: 'a@b.c',
      role: Role.USER,
    };
    expect(() => guard.canActivate(contextWith(user))).toThrow(
      ForbiddenException,
    );
  });
});
