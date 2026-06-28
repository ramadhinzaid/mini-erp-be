import { Role } from '@prisma/client';

/**
 * Shape of the user object attached to the request by the JWT strategy after
 * a token is validated. This is the identity the rest of the app trusts.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
}
