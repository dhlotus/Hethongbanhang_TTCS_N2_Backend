export class DiscountTier {
  id: string;
  minQuantity: number;
  maxQuantity: number | null;
  discountValue: number;

  constructor(partial: Partial<DiscountTier>) {
    Object.assign(this, partial);
    if (!this.id) {
      this.id = `tier-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    }
  }
}
