export const jwtConfig = {
  secret: process.env.JWT_SECRET ?? 'htbh-jwt-secret-key',
  expiresIn: process.env.JWT_EXPIRES_IN ?? '1h',
  refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'htbh-jwt-refresh-secret',
  refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
};
