export type SalesTargetType = 'EMPLOYEE' | 'REGION';

export class SalesTargetEntity {
  id: string;
  period: string; // YYYY-MM
  targetType: SalesTargetType;
  targetId: string; // employee userId hoặc region name (vd: 'Miền Nam')
  targetName: string;
  targetAmount: number; // VNĐ
  note?: string;
  isLocked: boolean;
  createdById: string;
  createdByName: string;
  createdAt: Date;
  updatedAt: Date;

  constructor(partial: Partial<SalesTargetEntity>) {
    Object.assign(this, partial);
    this.targetAmount = Number(partial.targetAmount ?? 0);
    this.isLocked = Boolean(partial.isLocked);
    this.createdAt = partial.createdAt ? new Date(partial.createdAt) : new Date();
    this.updatedAt = partial.updatedAt ? new Date(partial.updatedAt) : new Date();
  }
}
