import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AppConfig } from 'src/config/configuration';
import { AuthenticatedUser } from 'src/common/types/authenticated-user';
import { UsersService } from 'src/modules/users/users.service';
import { JwtPayload } from '../types/jwt-payload';

/**
 * Validates the bearer access token. On success the returned object is set as
 * `request.user`. We re-check the user still exists and is active on every
 * request so deactivated accounts lose access immediately.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('jwt.accessSecret', { infer: true }),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.usersService.findByEmail(payload.email);
    if (!user || !user.isActive || user.id !== payload.sub) {
      throw new UnauthorizedException('Invalid or inactive account');
    }

    return { id: user.id, email: user.email, role: user.role };
  }
}
