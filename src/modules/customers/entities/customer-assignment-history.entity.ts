/**
 * Thực thể Lịch sử Chuyển giao & Phân công Địa bàn Đại lý (SN-35)
 */
export class CustomerAssignmentHistoryEntity {
  id: string;
  transferBatchId: string;
  customerId: string;
  customerCode: string;
  customerName: string;
  region: string;
  fromSalesRepId?: string | null;
  fromSalesRepName?: string | null;
  toSalesRepId: string;
  toSalesRepName: string;
  performedById: string;
  performedByName: string;
  reason: string;
  notes?: string;
  createdAt: Date;

  constructor(partial: Partial<CustomerAssignmentHistoryEntity>) {
    Object.assign(this, partial);
    this.createdAt = partial.createdAt ? new Date(partial.createdAt) : new Date();
  }
}
