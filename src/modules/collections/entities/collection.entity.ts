export type CollectionStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type PaymentMethod = 'CASH' | 'BANK_TRANSFER';

export class RouteCollectionEntity {
  id: string;
  code: string;
  agencyId: string;
  agencyName: string;
  salesRepId: string;
  salesRepName: string;
  amount: number;
  paymentMethod: PaymentMethod;
  receiptImageUrl: string;
  status: CollectionStatus;
  collectionDate: Date;
  note?: string;
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: Date;
  rejectionReason?: string;
  createdAt: Date;
  updatedAt: Date;

  constructor(partial: Partial<RouteCollectionEntity>) {
    Object.assign(this, partial);
  }
}
