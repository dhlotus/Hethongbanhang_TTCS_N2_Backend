import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  forwardRef,
  Inject,
  Optional,
} from '@nestjs/common';
import { InvoicesService, InvoiceItem } from './invoices.service';
import { MailService } from '../mail/mail.service';
import { CustomersService } from '../customers/customers.service';
import { DatabaseService } from '../../database/database.service';

export interface DebtReminderLog {
  id: string;
  invoiceId: string;
  invoiceCode: string;
  customerId: string;
  customerName: string;
  recipientEmail: string;
  type: 'UPCOMING_3_DAYS' | 'OVERDUE';
  overdueDays?: number;
  remainingAmount: number;
  sentDate: string; // YYYY-MM-DD (Giờ VN)
  status: 'SUCCESS' | 'FAILED';
  errorMessage?: string;
  previewUrl?: string;
  createdAt: Date;
}

export interface InAppDebtNotification {
  id: string;
  customerId: string;
  invoiceId: string;
  invoiceCode: string;
  type: 'DEBT_REMINDER_3_DAYS' | 'DEBT_OVERDUE';
  title: string;
  message: string;
  amount: number;
  dueDate: Date | string;
  overdueDays?: number;
  link: string;
  isRead: boolean;
  priority: 'normal' | 'high';
  createdAt: Date;
}

/**
 * Service Nhắc Hạn Thanh Toán Tự Động (SN-208)
 * - Tác vụ chạy định kỳ kiểm tra các hóa đơn còn dư nợ
 * - Nhắc trước hạn 3 ngày & Nhắc khi quá hạn
 * - Chống gửi trùng thông báo trong cùng một ngày theo múi giờ Việt Nam (Asia/Ho_Chi_Minh)
 * - Hỗ trợ retry an toàn khi gửi email thất bại
 */
@Injectable()
export class DebtReminderSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DebtReminderSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  // Lưu lịch sử gửi để chống trùng lặp trong ngày
  private readonly reminderLogs = new Map<string, DebtReminderLog>();
  // Lưu thông báo trong ứng dụng (In-app notifications)
  private readonly inAppNotifications: InAppDebtNotification[] = [];

  constructor(
    @Inject(forwardRef(() => InvoicesService))
    private readonly invoicesService: InvoicesService,
    private readonly mailService: MailService,
    @Optional()
    @Inject(forwardRef(() => CustomersService))
    private readonly customersService?: CustomersService,
    @Optional() private readonly dbService?: DatabaseService,
  ) {}

  onModuleInit(): void {
    this.startDailyScheduler();
  }

  onModuleDestroy(): void {
    this.stopDailyScheduler();
  }

  /**
   * Khởi chạy scheduler định kỳ (kiểm tra mỗi giờ để khớp lịch chạy 08:00 sáng VN hoặc mỗi 24h)
   */
  startDailyScheduler(): void {
    if (this.timer) return;
    this.logger.log('[DebtScheduler] Khởi chạy worker nhắc hạn thanh toán hóa đơn công nợ (SN-208).');
    
    // Kiểm tra định kỳ mỗi 1 giờ
    this.timer = setInterval(async () => {
      const nowVN = this.getVietnamDate();
      const currentHour = parseInt(
        new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Asia/Ho_Chi_Minh',
          hour: '2-digit',
          hour12: false,
        }).format(nowVN),
        10,
      );

      // Chạy chính thức vào khung giờ 08:00 - 09:00 sáng mỗi ngày
      if (currentHour === 8) {
        await this.processDebtReminders();
      }
    }, 60 * 60 * 1000);
  }

  stopDailyScheduler(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.log('[DebtScheduler] Đã dừng worker nhắc hạn thanh toán.');
    }
  }

  /**
   * Lấy ngày hiện tại theo múi giờ Việt Nam (Asia/Ho_Chi_Minh) dạng YYYY-MM-DD
   */
  getVietnamDateString(date = new Date()): string {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(date);
  }

  getVietnamDate(date = new Date()): Date {
    return new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  }

  /**
   * Tính số ngày còn lại đến hạn hoặc số ngày quá hạn theo chuẩn lịch Việt Nam
   */
  calculateDueDayDiff(dueDate: Date | string): number {
    const todayStr = this.getVietnamDateString();
    const todayVN = new Date(todayStr + 'T00:00:00+07:00');

    const dueStr = this.getVietnamDateString(new Date(dueDate));
    const dueVN = new Date(dueStr + 'T00:00:00+07:00');

    const diffMs = dueVN.getTime() - todayVN.getTime();
    return Math.round(diffMs / (1000 * 60 * 60 * 24));
  }

  /**
   * Tạo khóa chống trùng lặp duy nhất cho 1 hóa đơn, 1 loại nhắc nợ trong 1 ngày
   */
  private getDeduplicationKey(invoiceId: string, type: 'UPCOMING_3_DAYS' | 'OVERDUE', dateStr: string): string {
    return `${invoiceId}:${type}:${dateStr}`;
  }

  /**
   * Xử lý quét hóa đơn và gửi thông báo nhắc hạn (SN-208 A, B, C, D)
   * Có Mutex chống chạy đồng thời, chống gửi trùng trong ngày, hỗ trợ retry an toàn
   */
  async processDebtReminders(options?: { forceRetry?: boolean }): Promise<{
    scannedInvoices: number;
    upcomingRemindersSent: number;
    overdueRemindersSent: number;
    skippedAlreadySent: number;
    failedCount: number;
    details: Array<{
      invoiceCode: string;
      customerName: string;
      type: string;
      status: string;
      email: string;
      note?: string;
    }>;
  }> {
    if (this.isRunning) {
      this.logger.warn('[DebtScheduler] Tác vụ đang chạy, bỏ qua lần kích hoạt trùng lặp.');
      return {
        scannedInvoices: 0,
        upcomingRemindersSent: 0,
        overdueRemindersSent: 0,
        skippedAlreadySent: 0,
        failedCount: 0,
        details: [],
      };
    }

    this.isRunning = true;
    const todayStr = this.getVietnamDateString();
    this.logger.log(`[DebtScheduler] Bắt đầu quét hóa đơn công nợ ngày ${todayStr}...`);

    let upcomingCount = 0;
    let overdueCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    const executionDetails: Array<{
      invoiceCode: string;
      customerName: string;
      type: string;
      status: string;
      email: string;
      note?: string;
    }> = [];

    try {
      // 1. Lấy toàn bộ hóa đơn từ InvoicesService
      const allInvoices = await this.invoicesService.getAllRawInvoices();
      const activeUnpaidInvoices = allInvoices.filter(
        (inv) =>
          inv.remainingAmount > 0 &&
          inv.status !== 'PAID' &&
          inv.status !== 'CANCELLED' &&
          inv.status !== 'DRAFT',
      );

      for (const invoice of activeUnpaidInvoices) {
        const dayDiff = this.calculateDueDayDiff(invoice.dueDate);
        const recipientEmail =
          invoice.customerEmail ||
          (await this.resolveCustomerEmail(invoice.customerId)) ||
          'dealer@loha.vn';

        // ────────────────────────────────────────────────────────────────────
        // TRƯỜNG HỢP 1: Còn đúng 3 ngày đến hạn (dayDiff === 3) — SN-208 A
        // ────────────────────────────────────────────────────────────────────
        if (dayDiff === 3) {
          const dedupeKey = this.getDeduplicationKey(invoice.id, 'UPCOMING_3_DAYS', todayStr);
          const existingLog = this.reminderLogs.get(dedupeKey);

          // Kiểm tra xem đã gửi thành công hôm nay chưa
          if (existingLog && existingLog.status === 'SUCCESS' && !options?.forceRetry) {
            skippedCount++;
            executionDetails.push({
              invoiceCode: invoice.invoiceCode,
              customerName: invoice.customerName,
              type: 'UPCOMING_3_DAYS',
              status: 'SKIPPED_ALREADY_SENT',
              email: recipientEmail,
              note: `Đã gửi thành công lúc ${existingLog.createdAt.toLocaleTimeString('vi-VN')}`,
            });
            continue;
          }

          // Gửi Email nhắc trước hạn 3 ngày
          try {
            const emailRes = await this.mailService.sendDebtReminderEmail({
              to: recipientEmail,
              customerName: invoice.customerName,
              invoiceCode: invoice.invoiceCode,
              orderCode: invoice.orderCode,
              remainingAmount: invoice.remainingAmount,
              dueDate: invoice.dueDate,
              viewUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/portal/debt?invoiceId=${invoice.id}`,
            });

            // Tạo In-app notification
            this.createInAppNotification({
              customerId: invoice.customerId,
              invoiceId: invoice.id,
              invoiceCode: invoice.invoiceCode,
              type: 'DEBT_REMINDER_3_DAYS',
              title: `Nhắc hạn thanh toán HĐ ${invoice.invoiceCode}`,
              message: `Hóa đơn ${invoice.invoiceCode} còn nợ ${new Intl.NumberFormat('vi-VN').format(invoice.remainingAmount)} đ sẽ đến hạn trong 3 ngày tới (${new Date(invoice.dueDate).toLocaleDateString('vi-VN')}). Quý đại lý vui lòng thanh toán đúng hạn.`,
              amount: invoice.remainingAmount,
              dueDate: invoice.dueDate,
              link: `/portal/debt?invoiceId=${invoice.id}`,
              priority: 'normal',
            });

            // Lưu log thành công
            const logEntry: DebtReminderLog = {
              id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
              invoiceId: invoice.id,
              invoiceCode: invoice.invoiceCode,
              customerId: invoice.customerId,
              customerName: invoice.customerName,
              recipientEmail,
              type: 'UPCOMING_3_DAYS',
              remainingAmount: invoice.remainingAmount,
              sentDate: todayStr,
              status: emailRes.success ? 'SUCCESS' : 'FAILED',
              previewUrl: emailRes.previewUrl,
              createdAt: new Date(),
            };
            this.reminderLogs.set(dedupeKey, logEntry);

            if (emailRes.success) {
              upcomingCount++;
              executionDetails.push({
                invoiceCode: invoice.invoiceCode,
                customerName: invoice.customerName,
                type: 'UPCOMING_3_DAYS',
                status: 'SENT_SUCCESS',
                email: recipientEmail,
              });
            } else {
              failedCount++;
              executionDetails.push({
                invoiceCode: invoice.invoiceCode,
                customerName: invoice.customerName,
                type: 'UPCOMING_3_DAYS',
                status: 'FAILED',
                email: recipientEmail,
                note: 'Gửi qua Ethereal/SMTP báo lỗi',
              });
            }
          } catch (err: any) {
            failedCount++;
            this.reminderLogs.set(dedupeKey, {
              id: `log-${Date.now()}`,
              invoiceId: invoice.id,
              invoiceCode: invoice.invoiceCode,
              customerId: invoice.customerId,
              customerName: invoice.customerName,
              recipientEmail,
              type: 'UPCOMING_3_DAYS',
              remainingAmount: invoice.remainingAmount,
              sentDate: todayStr,
              status: 'FAILED',
              errorMessage: err.message,
              createdAt: new Date(),
            });
            executionDetails.push({
              invoiceCode: invoice.invoiceCode,
              customerName: invoice.customerName,
              type: 'UPCOMING_3_DAYS',
              status: 'ERROR',
              email: recipientEmail,
              note: err.message,
            });
          }
        }

        // ────────────────────────────────────────────────────────────────────
        // TRƯỜNG HỢP 2: Đã quá hạn thanh toán (dayDiff < 0) — SN-208 B
        // ────────────────────────────────────────────────────────────────────
        else if (dayDiff < 0) {
          const overdueDays = Math.abs(dayDiff);
          const dedupeKey = this.getDeduplicationKey(invoice.id, 'OVERDUE', todayStr);
          const existingLog = this.reminderLogs.get(dedupeKey);

          // Chống gửi trùng trong ngày
          if (existingLog && existingLog.status === 'SUCCESS' && !options?.forceRetry) {
            skippedCount++;
            executionDetails.push({
              invoiceCode: invoice.invoiceCode,
              customerName: invoice.customerName,
              type: 'OVERDUE',
              status: 'SKIPPED_ALREADY_SENT',
              email: recipientEmail,
              note: `Đã gửi cảnh báo hôm nay (${overdueDays} ngày quá hạn)`,
            });
            continue;
          }

          // Gửi Email cảnh báo quá hạn
          try {
            const emailRes = await this.mailService.sendDebtOverdueEmail({
              to: recipientEmail,
              customerName: invoice.customerName,
              invoiceCode: invoice.invoiceCode,
              orderCode: invoice.orderCode,
              remainingAmount: invoice.remainingAmount,
              overdueDays,
              dueDate: invoice.dueDate,
              viewUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/portal/debt?invoiceId=${invoice.id}`,
            });

            // Tạo In-app notification với priority high
            this.createInAppNotification({
              customerId: invoice.customerId,
              invoiceId: invoice.id,
              invoiceCode: invoice.invoiceCode,
              type: 'DEBT_OVERDUE',
              title: `Cảnh báo HĐ ${invoice.invoiceCode} quá hạn ${overdueDays} ngày`,
              message: `Hóa đơn ${invoice.invoiceCode} đã quá hạn ${overdueDays} ngày (hạn: ${new Date(invoice.dueDate).toLocaleDateString('vi-VN')}). Số tiền còn nợ: ${new Intl.NumberFormat('vi-VN').format(invoice.remainingAmount)} đ. Vui lòng tất toán để duy trì hạn mức đặt hàng.`,
              amount: invoice.remainingAmount,
              dueDate: invoice.dueDate,
              overdueDays,
              link: `/portal/debt?invoiceId=${invoice.id}`,
              priority: 'high',
            });

            const logEntry: DebtReminderLog = {
              id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
              invoiceId: invoice.id,
              invoiceCode: invoice.invoiceCode,
              customerId: invoice.customerId,
              customerName: invoice.customerName,
              recipientEmail,
              type: 'OVERDUE',
              overdueDays,
              remainingAmount: invoice.remainingAmount,
              sentDate: todayStr,
              status: emailRes.success ? 'SUCCESS' : 'FAILED',
              previewUrl: emailRes.previewUrl,
              createdAt: new Date(),
            };
            this.reminderLogs.set(dedupeKey, logEntry);

            if (emailRes.success) {
              overdueCount++;
              executionDetails.push({
                invoiceCode: invoice.invoiceCode,
                customerName: invoice.customerName,
                type: 'OVERDUE',
                status: 'SENT_SUCCESS',
                email: recipientEmail,
                note: `Quá hạn ${overdueDays} ngày`,
              });
            } else {
              failedCount++;
              executionDetails.push({
                invoiceCode: invoice.invoiceCode,
                customerName: invoice.customerName,
                type: 'OVERDUE',
                status: 'FAILED',
                email: recipientEmail,
              });
            }
          } catch (err: any) {
            failedCount++;
            this.reminderLogs.set(dedupeKey, {
              id: `log-${Date.now()}`,
              invoiceId: invoice.id,
              invoiceCode: invoice.invoiceCode,
              customerId: invoice.customerId,
              customerName: invoice.customerName,
              recipientEmail,
              type: 'OVERDUE',
              overdueDays,
              remainingAmount: invoice.remainingAmount,
              sentDate: todayStr,
              status: 'FAILED',
              errorMessage: err.message,
              createdAt: new Date(),
            });
            executionDetails.push({
              invoiceCode: invoice.invoiceCode,
              customerName: invoice.customerName,
              type: 'OVERDUE',
              status: 'ERROR',
              email: recipientEmail,
              note: err.message,
            });
          }
        }
      }
    } finally {
      this.isRunning = false;
    }

    this.logger.log(
      `[DebtScheduler] Hoàn tất quét công nợ: ${upcomingCount} nhắc 3 ngày, ${overdueCount} cảnh báo quá hạn, ${skippedCount} bỏ qua trùng lặp, ${failedCount} lỗi.`,
    );

    return {
      scannedInvoices: upcomingCount + overdueCount + skippedCount + failedCount,
      upcomingRemindersSent: upcomingCount,
      overdueRemindersSent: overdueCount,
      skippedAlreadySent: skippedCount,
      failedCount,
      details: executionDetails,
    };
  }

  /**
   * Tạo thông báo trong ứng dụng (In-app notification)
   */
  private createInAppNotification(data: Omit<InAppDebtNotification, 'id' | 'isRead' | 'createdAt'>): InAppDebtNotification {
    const notif: InAppDebtNotification = {
      id: `notif-debt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      isRead: false,
      createdAt: new Date(),
      ...data,
    };
    this.inAppNotifications.unshift(notif);
    return notif;
  }

  /**
   * Lấy danh sách thông báo công nợ cho đại lý
   */
  getInAppNotificationsForCustomer(customerId: string): InAppDebtNotification[] {
    return this.inAppNotifications.filter((n) => n.customerId === customerId || customerId === 'ALL');
  }

  /**
   * Đánh dấu đã đọc thông báo
   */
  markNotificationAsRead(id: string): boolean {
    const found = this.inAppNotifications.find((n) => n.id === id);
    if (found) {
      found.isRead = true;
      return true;
    }
    return false;
  }

  /**
   * Lấy toàn bộ nhật ký nhắc nợ (phục vụ đối soát và kiểm chứng)
   */
  getReminderLogs(): DebtReminderLog[] {
    return Array.from(this.reminderLogs.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  private async resolveCustomerEmail(customerId: string): Promise<string | undefined> {
    if (!this.customersService) return undefined;
    try {
      const customer = await this.customersService.getCustomerById(customerId);
      return customer?.email;
    } catch {
      return undefined;
    }
  }
}
