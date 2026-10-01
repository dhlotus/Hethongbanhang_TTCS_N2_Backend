import type { StringValue } from 'ms';

export interface IJwtConfig {
  secret: string;
  expiresIn: StringValue | number;
  refreshSecret: string;
  refreshExpiresIn: StringValue | number;
}

export const jwtConfig: IJwtConfig = {
  secret: process.env.JWT_SECRET ?? 'htbh-jwt-secret-key',
  expiresIn: (process.env.JWT_EXPIRES_IN as StringValue) ?? '1h',
  refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'htbh-jwt-refresh-secret',
  refreshExpiresIn: (process.env.JWT_REFRESH_EXPIRES_IN as StringValue) ?? '7d',
};
