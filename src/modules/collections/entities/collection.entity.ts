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
  orderCodes?: string[];
  orderIds?: string[];
  orderDetails?: Array<{
    orderId?: string;
    orderCode: string;
    totalAmount: number;
    remainingAmount?: number;
    collectedAmount?: number;
    status?: string;
  }>;
  createdAt: Date;
  updatedAt: Date;

  constructor(partial: Partial<RouteCollectionEntity>) {
    Object.assign(this, partial);
  }
}
