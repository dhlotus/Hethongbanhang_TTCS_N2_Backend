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
 * - Lưu trữ lịch sử gửi và thông báo bền vững vào PostgreSQL
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

  async onModuleInit(): Promise<void> {
    await this.loadPersistedDataFromDb();
    this.startDailyScheduler();
  }

  onModuleDestroy(): void {
    this.stopDailyScheduler();
  }

  /**
   * Tải nhật ký và thông báo đã lưu trong PostgreSQL khi khởi động
   */
  private async loadPersistedDataFromDb(): Promise<void> {
    if (!this.dbService?.isConnected()) return;

    try {
      // 1. Tải logs
      const logRows = await this.dbService.query<any>(`
        SELECT * FROM app_debt_reminder_logs ORDER BY created_at DESC LIMIT 500;
      `);
      if (logRows) {
        for (const r of logRows) {
          const dedupeKey = this.getDeduplicationKey(r.invoice_id, r.reminder_type, r.sent_date);
          this.reminderLogs.set(dedupeKey, {
            id: r.id,
            invoiceId: r.invoice_id,
            invoiceCode: r.invoice_code,
            customerId: r.customer_id,
            customerName: r.customer_name,
            recipientEmail: r.recipient_email,
            type: r.reminder_type,
            overdueDays: r.overdue_days,
            remainingAmount: Number(r.remaining_amount || 0),
            sentDate: r.sent_date,
            status: r.status,
            errorMessage: r.error_message,
            previewUrl: r.preview_url,
            createdAt: new Date(r.created_at),
          });
        }
      }

      // 2. Tải notifications
      const notifRows = await this.dbService.query<any>(`
        SELECT * FROM app_debt_notifications ORDER BY created_at DESC LIMIT 200;
      `);
      if (notifRows) {
        for (const n of notifRows) {
          this.inAppNotifications.push({
            id: n.id,
            customerId: n.customer_id,
            invoiceId: n.invoice_id,
            invoiceCode: n.invoice_code,
            type: n.type,
            title: n.title,
            message: n.message,
            amount: Number(n.amount || 0),
            dueDate: new Date(n.due_date),
            overdueDays: n.overdue_days,
            link: n.link,
            isRead: Boolean(n.is_read),
            priority: n.priority,
            createdAt: new Date(n.created_at),
          });
        }
      }

      this.logger.log(
        `[DebtScheduler] Đã nạp ${this.reminderLogs.size} nhật ký và ${this.inAppNotifications.length} thông báo từ DB.`,
      );
    } catch (err: any) {
      this.logger.warn(`[DebtScheduler] Chưa thể nạp dữ liệu cũ từ DB: ${err.message}`);
    }
  }

  /**
   * Khởi chạy scheduler định kỳ (kiểm tra mỗi 30 phút để kích hoạt đúng 08:00 sáng VN mỗi ngày)
   */
  startDailyScheduler(): void {
    if (this.timer) return;
    this.logger.log('[DebtScheduler] Khởi chạy worker nhắc hạn thanh toán hóa đơn công nợ (SN-208).');

    // Chạy kiểm tra mỗi 30 phút
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

      // Chạy chính thức vào khung giờ 08:00 sáng mỗi ngày
      if (currentHour === 8) {
        await this.processDebtReminders();
      }
    }, 30 * 60 * 1000);
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

      await Promise.allSettled(
        activeUnpaidInvoices.map(async (invoice) => {
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
          let existingLog = this.reminderLogs.get(dedupeKey);

          // Kiểm tra thêm trong DB nếu bộ nhớ chưa có
          if (!existingLog && this.dbService?.isConnected()) {
            try {
              const rows = await this.dbService.query<any>(
                `SELECT * FROM app_debt_reminder_logs 
                 WHERE invoice_id = $1 AND reminder_type = 'UPCOMING_3_DAYS' AND sent_date = $2 AND status = 'SUCCESS' LIMIT 1`,
                [invoice.id, todayStr],
              );
              if (rows && rows.length > 0) {
                existingLog = {
                  id: rows[0].id,
                  invoiceId: rows[0].invoice_id,
                  invoiceCode: rows[0].invoice_code,
                  customerId: rows[0].customer_id,
                  customerName: rows[0].customer_name,
                  recipientEmail: rows[0].recipient_email,
                  type: 'UPCOMING_3_DAYS',
                  remainingAmount: Number(rows[0].remaining_amount),
                  sentDate: rows[0].sent_date,
                  status: 'SUCCESS',
                  createdAt: new Date(rows[0].created_at),
                };
                this.reminderLogs.set(dedupeKey, existingLog);
              }
            } catch {}
          }

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
            return;
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
            await this.createInAppNotification({
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

            // Lưu log
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
            await this.persistLogToDb(logEntry);

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
            const failedEntry: DebtReminderLog = {
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
            };
            this.reminderLogs.set(dedupeKey, failedEntry);
            await this.persistLogToDb(failedEntry);

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
          let existingLog = this.reminderLogs.get(dedupeKey);

          // Kiểm tra trong DB nếu bộ nhớ chưa có
          if (!existingLog && this.dbService?.isConnected()) {
            try {
              const rows = await this.dbService.query<any>(
                `SELECT * FROM app_debt_reminder_logs 
                 WHERE invoice_id = $1 AND reminder_type = 'OVERDUE' AND sent_date = $2 AND status = 'SUCCESS' LIMIT 1`,
                [invoice.id, todayStr],
              );
              if (rows && rows.length > 0) {
                existingLog = {
                  id: rows[0].id,
                  invoiceId: rows[0].invoice_id,
                  invoiceCode: rows[0].invoice_code,
                  customerId: rows[0].customer_id,
                  customerName: rows[0].customer_name,
                  recipientEmail: rows[0].recipient_email,
                  type: 'OVERDUE',
                  overdueDays: rows[0].overdue_days,
                  remainingAmount: Number(rows[0].remaining_amount),
                  sentDate: rows[0].sent_date,
                  status: 'SUCCESS',
                  createdAt: new Date(rows[0].created_at),
                };
                this.reminderLogs.set(dedupeKey, existingLog);
              }
            } catch {}
          }

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
            return;
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
            await this.createInAppNotification({
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
            await this.persistLogToDb(logEntry);

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
            const failedEntry: DebtReminderLog = {
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
            };
            this.reminderLogs.set(dedupeKey, failedEntry);
            await this.persistLogToDb(failedEntry);

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
      }),
    );
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

  private async persistLogToDb(log: DebtReminderLog): Promise<void> {
    if (!this.dbService?.isConnected()) return;
    try {
      await this.dbService.query(
        `INSERT INTO app_debt_reminder_logs (id, invoice_id, invoice_code, customer_id, customer_name, recipient_email, reminder_type, overdue_days, remaining_amount, sent_date, status, error_message, preview_url, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (id) DO UPDATE SET status = $11, error_message = $12, preview_url = $13;`,
        [
          log.id,
          log.invoiceId,
          log.invoiceCode,
          log.customerId,
          log.customerName,
          log.recipientEmail,
          log.type,
          log.overdueDays || 0,
          log.remainingAmount,
          log.sentDate,
          log.status,
          log.errorMessage || null,
          log.previewUrl || null,
          log.createdAt,
        ],
      );
    } catch (err: any) {
      this.logger.warn(`[DebtScheduler] Lỗi ghi log vào DB: ${err.message}`);
    }
  }

  /**
   * Tạo thông báo trong ứng dụng (In-app notification)
   */
  private async createInAppNotification(
    data: Omit<InAppDebtNotification, 'id' | 'isRead' | 'createdAt'>,
  ): Promise<InAppDebtNotification> {
    const notif: InAppDebtNotification = {
      id: `notif-debt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      isRead: false,
      createdAt: new Date(),
      ...data,
    };
    this.inAppNotifications.unshift(notif);

    if (this.dbService?.isConnected()) {
      try {
        await this.dbService.query(
          `INSERT INTO app_debt_notifications (id, customer_id, invoice_id, invoice_code, type, title, message, amount, due_date, overdue_days, link, is_read, priority, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
           ON CONFLICT (id) DO NOTHING;`,
          [
            notif.id,
            notif.customerId,
            notif.invoiceId,
            notif.invoiceCode,
            notif.type,
            notif.title,
            notif.message,
            notif.amount,
            new Date(notif.dueDate),
            notif.overdueDays || 0,
            notif.link,
            notif.isRead,
            notif.priority,
            notif.createdAt,
          ],
        );
      } catch (err: any) {
        this.logger.warn(`[DebtScheduler] Lỗi lưu thông báo vào DB: ${err.message}`);
      }
    }

    return notif;
  }

  /**
   * Lấy danh sách thông báo công nợ cho đại lý (đảm bảo cách ly dữ liệu)
   */
  getInAppNotificationsForCustomer(customerId: string): InAppDebtNotification[] {
    return this.inAppNotifications.filter((n) => {
      if (customerId === 'ALL') return true;
      return (
        n.customerId === customerId ||
        (customerId === '55555555-0000-0000-0000-000000000001' && n.customerId === 'cust-001') ||
        (customerId === '55555555-0000-0000-0000-000000000002' && n.customerId === 'cust-002')
      );
    });
  }

  /**
   * Đánh dấu đã đọc thông báo
   */
  async markNotificationAsRead(id: string): Promise<boolean> {
    const found = this.inAppNotifications.find((n) => n.id === id);
    if (found) {
      found.isRead = true;
    }

    if (this.dbService?.isConnected()) {
      try {
        await this.dbService.query(`UPDATE app_debt_notifications SET is_read = true WHERE id = $1;`, [id]);
      } catch {}
    }

    return Boolean(found);
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
    if (this.dbService?.isConnected()) {
      try {
        const rows = await this.dbService.query<any>(`SELECT email FROM customers WHERE id = $1 LIMIT 1`, [customerId]);
        if (rows && rows[0]?.email) return rows[0].email;
      } catch {}
    }

    if (this.customersService) {
      try {
        const customer = await this.customersService.getCustomerById(customerId);
        return customer?.email;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}
