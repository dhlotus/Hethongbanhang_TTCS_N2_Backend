export class ProductEntity {
  id: string;
  sku: string;
  name: string;
  category: string;
  baseUnit: string;
  price: number;
  costPrice: number;
  margin: number;
  stockQuantity: number;
  status: 'ACTIVE' | 'INACTIVE';
  barcode?: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;

  constructor(partial: Partial<ProductEntity>) {
    Object.assign(this, partial);
    if (!this.createdAt) this.createdAt = new Date();
    if (!this.updatedAt) this.updatedAt = new Date();
  }
}
