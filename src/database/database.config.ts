// Database connection configuration placeholder
export const databaseConnectionConfig = {
  type: 'postgres',
  synchronize: false,
  logging: process.env.NODE_ENV === 'development',
};
