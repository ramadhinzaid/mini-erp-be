import { z } from 'zod';

/**
 * Zod schema describing the process environment. Passed to `@nestjs/config` via
 * the `validate` hook so the application fails fast (refuses to boot) when a
 * required variable is missing or malformed, keeping misconfiguration out of
 * production.
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  API_PREFIX: z.string().min(1).default('api'),

  DATABASE_URL: z
    .string()
    .regex(
      /^postgres(ql)?:\/\/.+/,
      'must be a valid PostgreSQL connection string',
    ),

  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_ACCESS_EXPIRES_IN: z.string().min(1).default('15m'),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_REFRESH_EXPIRES_IN: z.string().min(1).default('7d'),
});

export type EnvVars = z.infer<typeof envSchema>;

/**
 * Validates the raw environment. Throws an aggregated, human-readable error
 * listing every invalid variable (not just the first) when validation fails.
 */
export function validateEnv(config: Record<string, unknown>): EnvVars {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Environment validation failed — ${issues}`);
  }

  return result.data;
}
