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
  status: 'SUCCESS' | 'FAILED' | 'PARTIAL_SUCCESS';
  emailStatus: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  inAppStatus: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  errorMessage?: string;
  emailError?: string;
  inAppError?: string;
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
 * - Cô lập trạng thái retry theo từng kênh (Email / In-app), không gửi lặp kênh đã thành công
 */
@Injectable()
export class DebtReminderSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DebtReminderSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private lastDailyRunDate = '';

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
    await this.ensureTablesAndColumns();
    await this.loadPersistedDataFromDb();
    this.startDailyScheduler();
  }

  onModuleDestroy(): void {
    this.stopDailyScheduler();
  }

  /**
   * Đảm bảo cấu trúc bảng và cột bổ sung cho kênh gửi (email_status, in_app_status)
   */
  private async ensureTablesAndColumns(): Promise<void> {
    if (!this.dbService?.isConnected()) return;
    try {
      await this.dbService.query(`
        ALTER TABLE app_debt_reminder_logs 
        ADD COLUMN IF NOT EXISTS email_status VARCHAR(20) DEFAULT 'PENDING',
        ADD COLUMN IF NOT EXISTS in_app_status VARCHAR(20) DEFAULT 'PENDING',
        ADD COLUMN IF NOT EXISTS email_error TEXT,
        ADD COLUMN IF NOT EXISTS in_app_error TEXT;
      `);
    } catch (err: any) {
      this.logger.warn(`[DebtScheduler] Lỗi khởi tạo cột bảng app_debt_reminder_logs: ${err.message}`);
    }
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
          const emailStatus = r.email_status || (r.status === 'SUCCESS' ? 'SUCCESS' : 'FAILED');
          const inAppStatus = r.in_app_status || (r.status === 'SUCCESS' ? 'SUCCESS' : 'FAILED');
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
            emailStatus,
            inAppStatus,
            errorMessage: r.error_message,
            emailError: r.email_error,
            inAppError: r.in_app_error,
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
   * Khởi chạy scheduler định kỳ chạy mỗi ngày một lần theo múi giờ Việt Nam
   * Hoạt động bền vững ngay cả khi người dùng không mở trình duyệt website
   */
  startDailyScheduler(): void {
    if (this.timer) return;
    this.logger.log('[DebtScheduler] Khởi chạy worker nhắc hạn thanh toán hóa đơn công nợ (SN-208).');

    // Quét định kỳ mỗi 15 phút
    this.timer = setInterval(async () => {
      await this.checkAndRunDailyTask();
    }, 15 * 60 * 1000);

    // Kích hoạt kiểm tra sau khi khởi động backend
    setTimeout(() => {
      void this.checkAndRunDailyTask();
    }, 5000);
  }

  /**
   * Kiểm tra điều kiện chạy tác vụ ngày: Múi giờ Việt Nam, chạy một lần duy nhất trong ngày
   */
  async checkAndRunDailyTask(): Promise<void> {
    const todayStr = this.getVietnamDateString();
    if (this.lastDailyRunDate === todayStr) {
      return;
    }

    const nowVN = this.getVietnamDate();
    const currentHour = parseInt(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Ho_Chi_Minh',
        hour: '2-digit',
        hour12: false,
      }).format(nowVN),
      10,
    );

    // Chạy khi đến hoặc sau 08:00 sáng
    if (currentHour >= 8) {
      this.lastDailyRunDate = todayStr;
      this.logger.log(
        `[DebtScheduler] Kích hoạt tác vụ định kỳ tự động ngày ${todayStr} lúc ${currentHour}h (Múi giờ Việt Nam)...`,
      );
      await this.processDebtReminders();
    }
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
   * - Có Mutex chống chạy đồng thời
   * - Chống gửi trùng trong ngày bằng dữ liệu lưu bền vững
   * - Cô lập trạng thái thử lại: Kênh nào đã gửi thành công thì KHÔNG gửi lặp lại
   */
  async processDebtReminders(options?: { forceRetry?: boolean }): Promise<{
    sentCount?: number;
    totalSent?: number;
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
      emailStatus?: string;
      inAppStatus?: string;
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
      emailStatus?: string;
      inAppStatus?: string;
      note?: string;
    }> = [];

    try {
      // 1. Lấy toàn bộ hóa đơn thực tế từ InvoicesService (loại trừ PAID, CANCELLED, DRAFT)
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

          let reminderType: 'UPCOMING_3_DAYS' | 'OVERDUE' | null = null;
          let overdueDays = 0;

          if (dayDiff === 3) {
            reminderType = 'UPCOMING_3_DAYS';
          } else if (dayDiff < 0) {
            reminderType = 'OVERDUE';
            overdueDays = Math.abs(dayDiff);
          } else {
            // Không phải đúng 3 ngày trước hạn và không quá hạn -> Bỏ qua
            return;
          }

          const dedupeKey = this.getDeduplicationKey(invoice.id, reminderType, todayStr);
          let existingLog = this.reminderLogs.get(dedupeKey);

          // Kiểm tra thêm trong DB nếu bộ nhớ chưa có
          if (!existingLog && this.dbService?.isConnected()) {
            try {
              const rows = await this.dbService.query<any>(
                `SELECT * FROM app_debt_reminder_logs 
                 WHERE invoice_id = $1 AND reminder_type = $2 AND sent_date = $3 LIMIT 1`,
                [invoice.id, reminderType, todayStr],
              );
              if (rows && rows.length > 0) {
                const r = rows[0];
                existingLog = {
                  id: r.id,
                  invoiceId: r.invoice_id,
                  invoiceCode: r.invoice_code,
                  customerId: r.customer_id,
                  customerName: r.customer_name,
                  recipientEmail: r.recipient_email,
                  type: r.reminder_type,
                  overdueDays: r.overdue_days,
                  remainingAmount: Number(r.remaining_amount),
                  sentDate: r.sent_date,
                  status: r.status,
                  emailStatus: r.email_status || (r.status === 'SUCCESS' ? 'SUCCESS' : 'FAILED'),
                  inAppStatus: r.in_app_status || (r.status === 'SUCCESS' ? 'SUCCESS' : 'FAILED'),
                  errorMessage: r.error_message,
                  emailError: r.email_error,
                  inAppError: r.in_app_error,
                  previewUrl: r.preview_url,
                  createdAt: new Date(r.created_at),
                };
                this.reminderLogs.set(dedupeKey, existingLog);
              }
            } catch {}
          }

          const existingEmailSuccess = existingLog?.emailStatus === 'SUCCESS';
          const existingInAppSuccess = existingLog?.inAppStatus === 'SUCCESS';

          // Nếu cả hai kênh đều đã thành công hôm nay và không ép buộc thử lại
          if (existingEmailSuccess && existingInAppSuccess && !options?.forceRetry) {
            skippedCount++;
            executionDetails.push({
              invoiceCode: invoice.invoiceCode,
              customerName: invoice.customerName,
              type: reminderType,
              status: 'SKIPPED_ALREADY_SENT',
              email: recipientEmail,
              emailStatus: 'SKIPPED',
              inAppStatus: 'SKIPPED',
              note: `Cả Email và Thông báo in-app đều đã gửi thành công ngày ${todayStr}`,
            });
            return;
          }

          // ────────────────────────────────────────────────────────────────────
          // KÊNH 1: GỬI EMAIL (Chỉ gửi nếu chưa thành công hoặc forceRetry)
          // ────────────────────────────────────────────────────────────────────
          let emailStatus: 'SUCCESS' | 'FAILED' | 'SKIPPED' = 'SKIPPED';
          let emailError: string | undefined;
          let previewUrl: string | undefined;

          if (!existingEmailSuccess || options?.forceRetry) {
            try {
              if (reminderType === 'UPCOMING_3_DAYS') {
                const emailRes = await this.mailService.sendDebtReminderEmail({
                  to: recipientEmail,
                  customerName: invoice.customerName,
                  invoiceCode: invoice.invoiceCode,
                  orderCode: invoice.orderCode,
                  remainingAmount: invoice.remainingAmount,
                  dueDate: invoice.dueDate,
                  viewUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/portal/debt?invoiceId=${invoice.id}`,
                });
                if (emailRes.success) {
                  emailStatus = 'SUCCESS';
                  previewUrl = emailRes.previewUrl;
                } else {
                  emailStatus = 'FAILED';
                  emailError = (emailRes as any).error || 'Lỗi gửi email qua mail service';
                }
              } else {
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
                if (emailRes.success) {
                  emailStatus = 'SUCCESS';
                  previewUrl = emailRes.previewUrl;
                } else {
                  emailStatus = 'FAILED';
                  emailError = (emailRes as any).error || 'Lỗi gửi email qua mail service';
                }
              }
            } catch (err: any) {
              emailStatus = 'FAILED';
              emailError = err.message || 'Lỗi ngoại lệ gửi email';
            }
          } else {
            // Đã gửi email thành công trước đó -> Không gửi lặp lại
            emailStatus = 'SKIPPED';
          }

          // ────────────────────────────────────────────────────────────────────
          // KÊNH 2: THÔNG BÁO IN-APP (Chỉ tạo nếu chưa thành công hoặc forceRetry)
          // ────────────────────────────────────────────────────────────────────
          let inAppStatus: 'SUCCESS' | 'FAILED' | 'SKIPPED' = 'SKIPPED';
          let inAppError: string | undefined;

          if (!existingInAppSuccess || options?.forceRetry) {
            try {
              if (reminderType === 'UPCOMING_3_DAYS') {
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
              } else {
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
              }
              inAppStatus = 'SUCCESS';
            } catch (err: any) {
              inAppStatus = 'FAILED';
              inAppError = err.message || 'Lỗi tạo thông báo in-app';
            }
          } else {
            // Đã tạo thông báo in-app thành công trước đó -> Không tạo lặp lại
            inAppStatus = 'SKIPPED';
          }

          // Đánh giá trạng thái chung
          const finalEmailSuccess = emailStatus === 'SUCCESS' || (existingEmailSuccess && emailStatus === 'SKIPPED');
          const finalInAppSuccess = inAppStatus === 'SUCCESS' || (existingInAppSuccess && inAppStatus === 'SKIPPED');

          let overallStatus: 'SUCCESS' | 'FAILED' | 'PARTIAL_SUCCESS' = 'FAILED';
          if (finalEmailSuccess && finalInAppSuccess) {
            overallStatus = 'SUCCESS';
          } else if (finalEmailSuccess || finalInAppSuccess) {
            overallStatus = 'PARTIAL_SUCCESS';
          } else {
            overallStatus = 'FAILED';
          }

          const combinedError = [
            emailError ? `Email: ${emailError}` : null,
            inAppError ? `In-App: ${inAppError}` : null,
          ]
            .filter(Boolean)
            .join(' | ');

          // Lưu Log bền vững
          const logEntry: DebtReminderLog = {
            id: existingLog?.id || `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            invoiceId: invoice.id,
            invoiceCode: invoice.invoiceCode,
            customerId: invoice.customerId,
            customerName: invoice.customerName,
            recipientEmail,
            type: reminderType,
            overdueDays,
            remainingAmount: invoice.remainingAmount,
            sentDate: todayStr,
            status: overallStatus,
            emailStatus: finalEmailSuccess ? 'SUCCESS' : 'FAILED',
            inAppStatus: finalInAppSuccess ? 'SUCCESS' : 'FAILED',
            errorMessage: combinedError || undefined,
            emailError,
            inAppError,
            previewUrl: previewUrl || existingLog?.previewUrl,
            createdAt: existingLog?.createdAt || new Date(),
          };

          this.reminderLogs.set(dedupeKey, logEntry);
          await this.persistLogToDb(logEntry);

          if (overallStatus === 'SUCCESS') {
            if (reminderType === 'UPCOMING_3_DAYS') upcomingCount++;
            else overdueCount++;

            executionDetails.push({
              invoiceCode: invoice.invoiceCode,
              customerName: invoice.customerName,
              type: reminderType,
              status: 'SENT_SUCCESS',
              email: recipientEmail,
              emailStatus: emailStatus,
              inAppStatus: inAppStatus,
              note: reminderType === 'OVERDUE' ? `Quá hạn ${overdueDays} ngày` : 'Còn 3 ngày đến hạn',
            });
          } else {
            failedCount++;
            executionDetails.push({
              invoiceCode: invoice.invoiceCode,
              customerName: invoice.customerName,
              type: reminderType,
              status: overallStatus,
              email: recipientEmail,
              emailStatus: emailStatus,
              inAppStatus: inAppStatus,
              note: combinedError,
            });
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
      sentCount: upcomingCount + overdueCount,
      totalSent: upcomingCount + overdueCount,
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
        `INSERT INTO app_debt_reminder_logs (
          id, invoice_id, invoice_code, customer_id, customer_name, recipient_email, 
          reminder_type, overdue_days, remaining_amount, sent_date, status, 
          email_status, in_app_status, email_error, in_app_error, error_message, preview_url, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        ON CONFLICT (id) DO UPDATE SET 
          status = $11, 
          email_status = $12, 
          in_app_status = $13, 
          email_error = $14, 
          in_app_error = $15, 
          error_message = $16, 
          preview_url = $17;`,
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
          log.emailStatus,
          log.inAppStatus,
          log.emailError || null,
          log.inAppError || null,
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
   * Chống tạo trùng cho cùng hóa đơn, loại thông báo và ngày
   */
  private async createInAppNotification(
    data: Omit<InAppDebtNotification, 'id' | 'isRead' | 'createdAt'>,
  ): Promise<InAppDebtNotification> {
    const todayStr = this.getVietnamDateString();

    // 1. Kiểm tra chống trùng trong bộ nhớ
    const existingMemory = this.inAppNotifications.find(
      (n) =>
        n.invoiceId === data.invoiceId &&
        n.type === data.type &&
        this.getVietnamDateString(n.createdAt) === todayStr,
    );
    if (existingMemory) {
      if (this.dbService?.isConnected()) {
        try {
          const dbCheck = await this.dbService.query<any>(
            `SELECT id FROM app_debt_notifications WHERE id = $1 LIMIT 1;`,
            [existingMemory.id],
          );
          if (!dbCheck || dbCheck.length === 0) {
            await this.dbService.query(
              `INSERT INTO app_debt_notifications (id, customer_id, invoice_id, invoice_code, type, title, message, amount, due_date, overdue_days, link, is_read, priority, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
               ON CONFLICT (id) DO NOTHING;`,
              [
                existingMemory.id,
                existingMemory.customerId,
                existingMemory.invoiceId,
                existingMemory.invoiceCode,
                existingMemory.type,
                existingMemory.title,
                existingMemory.message,
                existingMemory.amount,
                new Date(existingMemory.dueDate),
                existingMemory.overdueDays || 0,
                existingMemory.link,
                existingMemory.isRead,
                existingMemory.priority,
                existingMemory.createdAt,
              ],
            );
          }
        } catch {}
      }
      return existingMemory;
    }

    // 2. Kiểm tra chống trùng trong PostgreSQL
    if (this.dbService?.isConnected()) {
      try {
        const rows = await this.dbService.query<any>(
          `SELECT * FROM app_debt_notifications 
           WHERE invoice_id = $1 AND type = $2 AND DATE(created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') = $3 LIMIT 1;`,
          [data.invoiceId, data.type, todayStr],
        );
        if (rows && rows.length > 0) {
          const n = rows[0];
          const found: InAppDebtNotification = {
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
          };
          this.inAppNotifications.unshift(found);
          return found;
        }
      } catch {}
    }

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
        (customerId === '55555555-0000-0000-0000-000000000001' && (n.customerId === 'cust-001' || n.customerId === 'cust-dl-0001')) ||
        (customerId === '55555555-0000-0000-0000-000000000002' && (n.customerId === 'cust-002' || n.customerId === 'cust-dl-0002'))
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
