export class RefreshTokenEntity {
  id!: string;
  userId!: string;
  token!: string;
  isRevoked!: boolean;
  expiresAt!: Date;
  createdAt!: Date;
  revokedAt?: Date;

  constructor(partial?: Partial<RefreshTokenEntity>) {
    if (partial) {
      Object.assign(this, partial);
    }
  }
}
