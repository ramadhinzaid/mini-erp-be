import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route as publicly accessible, bypassing the globally-registered
 * JWT authentication guard. Use sparingly (login, register, health, docs).
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
