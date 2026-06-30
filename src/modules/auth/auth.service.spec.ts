import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Role, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { UserEntity } from 'src/modules/users/entities/user.entity';
import { UsersService } from 'src/modules/users/users.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: {
    create: jest.Mock;
    findByEmail: jest.Mock;
    findById: jest.Mock;
  };
  let jwtService: { signAsync: jest.Mock; verifyAsync: jest.Mock };

  const userModel: User = {
    id: 'user-1',
    email: 'jane@example.com',
    password: '', // filled in per-test
    firstName: null,
    lastName: null,
    role: Role.USER,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    usersService = {
      create: jest.fn(),
      findByEmail: jest.fn(),
      findById: jest.fn(),
    };
    jwtService = {
      signAsync: jest.fn().mockResolvedValue('signed-token'),
      verifyAsync: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: { get: () => 'test-secret' } },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  describe('register', () => {
    it('creates the user and returns a token pair', async () => {
      usersService.create.mockResolvedValue(UserEntity.fromModel(userModel));

      const tokens = await service.register({
        email: userModel.email,
        password: 'PlainPass123!',
      });

      expect(usersService.create).toHaveBeenCalled();
      expect(tokens).toEqual({
        accessToken: 'signed-token',
        refreshToken: 'signed-token',
        tokenType: 'Bearer',
      });
      expect(jwtService.signAsync).toHaveBeenCalledTimes(2);
    });
  });

  describe('login', () => {
    it('issues tokens for valid credentials', async () => {
      const password = 'PlainPass123!';
      usersService.findByEmail.mockResolvedValue({
        ...userModel,
        password: await bcrypt.hash(password, 10),
      });

      const tokens = await service.login({ email: userModel.email, password });

      expect(tokens.accessToken).toBe('signed-token');
    });

    it('rejects invalid passwords without revealing which field failed', async () => {
      usersService.findByEmail.mockResolvedValue({
        ...userModel,
        password: await bcrypt.hash('the-real-password', 10),
      });

      await expect(
        service.login({ email: userModel.email, password: 'wrong-password' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects unknown emails', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@example.com', password: 'whatever12' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects inactive accounts even with the correct password', async () => {
      const password = 'PlainPass123!';
      usersService.findByEmail.mockResolvedValue({
        ...userModel,
        isActive: false,
        password: await bcrypt.hash(password, 10),
      });

      await expect(
        service.login({ email: userModel.email, password }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      // No tokens should be issued for a rejected login.
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('uses the same error message for every failed login factor', async () => {
      // Unknown email.
      usersService.findByEmail.mockResolvedValueOnce(null);
      const unknownEmailError = await service
        .login({ email: 'nobody@example.com', password: 'whatever12' })
        .catch((err: UnauthorizedException) => err);

      // Wrong password.
      usersService.findByEmail.mockResolvedValueOnce({
        ...userModel,
        password: await bcrypt.hash('the-real-password', 10),
      });
      const wrongPasswordError = await service
        .login({ email: userModel.email, password: 'wrong-password' })
        .catch((err: UnauthorizedException) => err);

      // Inactive account.
      usersService.findByEmail.mockResolvedValueOnce({
        ...userModel,
        isActive: false,
        password: await bcrypt.hash('PlainPass123!', 10),
      });
      const inactiveError = await service
        .login({ email: userModel.email, password: 'PlainPass123!' })
        .catch((err: UnauthorizedException) => err);

      expect(unknownEmailError).toBeInstanceOf(UnauthorizedException);
      expect(wrongPasswordError.message).toBe(unknownEmailError.message);
      expect(inactiveError.message).toBe(unknownEmailError.message);
    });

    it('never includes the password hash in the issued token response', async () => {
      const password = 'PlainPass123!';
      usersService.findByEmail.mockResolvedValue({
        ...userModel,
        password: await bcrypt.hash(password, 10),
      });

      const tokens = await service.login({ email: userModel.email, password });

      expect(tokens).toEqual({
        accessToken: 'signed-token',
        refreshToken: 'signed-token',
        tokenType: 'Bearer',
      });
      expect(Object.keys(tokens)).not.toContain('password');
    });
  });

  describe('refresh', () => {
    it('rejects an invalid refresh token', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('bad token'));

      await expect(service.refresh('bad-token')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('issues a new token pair for a valid refresh token', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: userModel.id,
        email: userModel.email,
        role: userModel.role,
      });
      usersService.findById.mockResolvedValue(UserEntity.fromModel(userModel));

      const tokens = await service.refresh('good-token');

      expect(usersService.findById).toHaveBeenCalledWith(userModel.id);
      expect(tokens.refreshToken).toBe('signed-token');
    });
  });
});
