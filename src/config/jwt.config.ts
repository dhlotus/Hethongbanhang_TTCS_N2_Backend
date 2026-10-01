export const jwtConfig = {
  secret: process.env.JWT_SECRET ?? 'htbh-jwt-secret-key',
  expiresIn: 3600, // 1 hour (3600 seconds)
  refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'htbh-jwt-refresh-secret',
  refreshExpiresIn: 7 * 24 * 3600, // 7 days (604800 seconds)
};
