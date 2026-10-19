export type NotificationType = 'ORDER' | 'STOCK_ALERT' | 'DELIVERY' | 'PRICING' | 'CREDIT' | 'SHIPMENT' | 'COLLECTION';

export class NotificationEntity {
  id: string;
  userId: string;
  recipientName?: string;
  recipientRole?: string;
  orderId?: string;
  orderCode?: string;
  customerName?: string;
  type: NotificationType;
  title: string;
  message: string;
  amount?: number;
  link: string;
  isRead: boolean;
  priority: 'high' | 'normal';
  createdAt: Date;
  updatedAt?: Date;

  constructor(partial: Partial<NotificationEntity>) {
    Object.assign(this, partial);
  }
}
