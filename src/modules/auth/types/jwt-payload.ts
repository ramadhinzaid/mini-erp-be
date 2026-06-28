import { Role } from '@prisma/client';

/** Claims encoded in the access/refresh JWTs. `sub` is the user id. */
export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
}
