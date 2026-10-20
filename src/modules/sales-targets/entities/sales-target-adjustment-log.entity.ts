import { SalesTargetType } from './sales-target.entity';

export class SalesTargetAdjustmentLogEntity {
  id: string;
  targetId: string;
  period: string;
  targetType: SalesTargetType;
  targetName: string;
  oldAmount: number;
  newAmount: number;
  reason: string;
  adjustedById: string;
  adjustedByName: string;
  adjustedAt: Date;

  constructor(partial: Partial<SalesTargetAdjustmentLogEntity>) {
    Object.assign(this, partial);
    this.oldAmount = Number(partial.oldAmount ?? 0);
    this.newAmount = Number(partial.newAmount ?? 0);
    this.adjustedAt = partial.adjustedAt ? new Date(partial.adjustedAt) : new Date();
  }
}
