import { OrderApprovalAction } from './order-approval-action.enum';

export class OrderApprovalHistoryEntity {
  id: number;
  orderId: string;
  action: OrderApprovalAction;
  comment: string | null;
  approverId: string;
  approverName: string;
  approverRoles: string[];
  createdAt: Date;

  constructor(partial: Partial<OrderApprovalHistoryEntity>) {
    Object.assign(this, partial);
  }
}
