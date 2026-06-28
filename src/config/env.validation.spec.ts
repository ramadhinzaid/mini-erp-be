import { validateEnv } from './env.validation';

const validEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/mini_erp',
  JWT_ACCESS_SECRET: 'a-sufficiently-long-secret',
  JWT_REFRESH_SECRET: 'another-sufficiently-long-secret',
};

describe('validateEnv', () => {
  it('accepts a valid environment and applies defaults', () => {
    const result = validateEnv({ ...validEnv });

    expect(result.NODE_ENV).toBe('development');
    expect(result.PORT).toBe(3000);
    expect(result.API_PREFIX).toBe('api');
    expect(result.JWT_ACCESS_EXPIRES_IN).toBe('15m');
    expect(result.JWT_REFRESH_EXPIRES_IN).toBe('7d');
  });

  it('coerces PORT to a number', () => {
    const result = validateEnv({ ...validEnv, PORT: '8080' });
    expect(result.PORT).toBe(8080);
  });

  it('throws when a required secret is missing', () => {
    const incomplete: Record<string, unknown> = { ...validEnv };
    delete incomplete.JWT_ACCESS_SECRET;
    expect(() => validateEnv(incomplete)).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('rejects a secret that is too short', () => {
    expect(() =>
      validateEnv({ ...validEnv, JWT_ACCESS_SECRET: 'too-short' }),
    ).toThrow(/Environment validation failed/);
  });

  it('rejects a non-PostgreSQL database url', () => {
    expect(() =>
      validateEnv({ ...validEnv, DATABASE_URL: 'mysql://localhost:3306/db' }),
    ).toThrow(/DATABASE_URL/);
  });

  it('rejects an invalid NODE_ENV', () => {
    expect(() => validateEnv({ ...validEnv, NODE_ENV: 'staging' })).toThrow(
      /NODE_ENV/,
    );
  });
});
