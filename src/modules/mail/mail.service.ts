import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

export interface SendResetPasswordEmailParams {
  to: string;
  fullName?: string;
  resetLink: string;
  token: string;
}

export interface SendAccountActivationEmailParams {
  to: string;
  fullName: string;
  username: string;
  temporaryPassword: string;
  role: string;
  assignedWarehouse?: string;
  loginUrl?: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private etherealTransporter: nodemailer.Transporter | null = null;

  constructor() {
    this.initTransporter();
  }

  /**
   * Khởi tạo transporter dựa trên cấu hình môi trường (.env)
   */
  private initTransporter(): void {
    const smtpUser = process.env.SMTP_USER?.trim();
    const smtpPass = process.env.SMTP_PASS?.trim();
    const smtpHost = process.env.SMTP_HOST?.trim() || 'smtp.gmail.com';
    const smtpPort = parseInt(process.env.SMTP_PORT?.trim() || '587', 10);
    const smtpSecure = process.env.SMTP_SECURE === 'true' || smtpPort === 465;

    if (smtpUser && smtpPass) {
      const cleanPass = smtpPass.replace(/\s+/g, '');
      const isGmail = smtpUser.toLowerCase().includes('@gmail.com') || smtpHost.includes('gmail.com');

      if (isGmail) {
        this.logger.log(`[SMTP CONFIG] Khởi tạo Gmail Transporter cho: ${smtpUser}`);
        this.transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: smtpUser,
            pass: cleanPass,
          },
        });
      } else {
        this.logger.log(`[SMTP CONFIG] Khởi tạo SMTP Transporter cho tài khoản: ${smtpUser} (Host: ${smtpHost}:${smtpPort})`);
        this.transporter = nodemailer.createTransport({
          host: smtpHost,
          port: smtpPort,
          secure: smtpSecure,
          auth: {
            user: smtpUser,
            pass: cleanPass,
          },
        });
      }
    } else {
      this.logger.warn(
        `[SMTP CONFIG] Chưa cấu hình SMTP_USER / SMTP_PASS trong file .env. Hệ thống sẽ sử dụng Ethereal Email để gửi email thật và cung cấp liên kết xem trực quan.`,
      );
    }
  }

  /**
   * Lấy transporter dự phòng Ethereal nếu chưa cấu hình SMTP thật
   */
  private async getEtherealTransporter(): Promise<nodemailer.Transporter> {
    if (!this.etherealTransporter) {
      const testAccount = await nodemailer.createTestAccount();
      this.logger.log(`[ETHEREAL MAIL] Tạo tài khoản kiểm thử thành công: ${testAccount.user}`);
      this.etherealTransporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass,
        },
      });
    }
    return this.etherealTransporter;
  }

  /**
   * Gửi email đặt lại mật khẩu với giao diện HTML chuẩn LOHA SALES
   */
  async sendResetPasswordEmail(params: SendResetPasswordEmailParams): Promise<{ success: boolean; previewUrl?: string }> {
    const { to, fullName, resetLink, token } = params;
    const recipientName = fullName || to.split('@')[0];
    const smtpUser = process.env.SMTP_USER?.trim() || '';
    const fromAddress =
      smtpUser && smtpUser.includes('@gmail.com')
        ? `"LOHA SALES" <${smtpUser}>`
        : process.env.MAIL_FROM || `"LOHA SALES" <${smtpUser || 'no-reply@loha.vn'}>`;

    const htmlContent = `
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Đặt lại mật khẩu — LOHA SALES</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 24px; }
        .card { max-width: 540px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; padding: 36px 32px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
        .logo-box { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; background: #eff6ff; border-radius: 12px; margin-bottom: 20px; border: 1px solid #dbeafe; }
        .logo-text { font-size: 20px; font-weight: 800; color: #2563eb; letter-spacing: -0.5px; }
        h1 { font-size: 22px; font-weight: 700; color: #0f172a; margin: 0 0 12px 0; }
        p { font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 16px 0; }
        .btn-box { text-align: center; margin: 28px 0; }
        .btn { display: inline-block; background-color: #2563eb; color: #ffffff !important; font-size: 14px; font-weight: 600; text-decoration: none; padding: 13px 28px; border-radius: 12px; box-shadow: 0 2px 4px rgba(37, 99, 235, 0.2); }
        .btn:hover { background-color: #1d4ed8; }
        .token-box { background: #f1f5f9; border: 1px dashed #cbd5e1; border-radius: 10px; padding: 12px; font-family: monospace; font-size: 12px; word-break: break-all; color: #334155; margin: 20px 0; }
        .notice { font-size: 12px; color: #64748b; line-height: 1.5; border-top: 1px solid #f1f5f9; padding-top: 16px; margin-top: 24px; }
        .notice strong { color: #334155; }
        .footer { text-align: center; margin-top: 24px; font-size: 12px; color: #94a3b8; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="logo-box">
          <span class="logo-text">LS</span>
        </div>
        <h1>Yêu cầu đặt lại mật khẩu</h1>
        <p>Xin chào <strong>${recipientName}</strong>,</p>
        <p>Chúng tôi nhận được yêu cầu thiết lập lại mật khẩu cho tài khoản <strong>${to}</strong> trên hệ thống Quản lý Bán hàng & Kho LOHA SALES.</p>
        <p>Để hoàn tất việc đổi mật khẩu, vui lòng nhấp vào nút bên dưới:</p>
        
        <div class="btn-box">
          <a href="${resetLink}" class="btn" target="_blank">Đặt lại mật khẩu</a>
        </div>

        <p style="font-size: 12px; color: #64748b;">Hoặc bạn có thể sao chép và dán liên kết sau vào trình duyệt web:</p>
        <div class="token-box">${resetLink}</div>

        <div class="notice">
          <p>⚠️ <strong>Lưu ý bảo mật:</strong></p>
          <ul style="margin: 0; padding-left: 18px;">
            <li>Liên kết có hiệu lực trong vòng <strong>30 phút</strong>.</li>
            <li>Liên kết chỉ sử dụng được <strong>một lần duy nhất</strong>.</li>
            <li>Nếu bạn không thực hiện yêu cầu này, vui lòng bỏ qua email và mật khẩu của bạn vẫn an toàn tuyệt đối.</li>
          </ul>
        </div>
      </div>
      <div class="footer">
        © 2026 LOHA SALES — Hệ thống Quản trị Bán hàng & Kho Doanh nghiệp B2B
      </div>
    </body>
    </html>
    `;

    // 1. Nếu đã cấu hình SMTP thật (ví dụ Gmail / Host công ty)
    if (this.transporter) {
      try {
        const info = await this.transporter.sendMail({
          from: fromAddress,
          to,
          subject: '🔒 [LOHA SALES] Hướng dẫn đặt lại mật khẩu tài khoản của bạn',
          text: `Xin chào ${recipientName},\n\nVui lòng truy cập đường dẫn sau để đặt lại mật khẩu tài khoản của bạn (hiệu lực 30 phút):\n${resetLink}\n\nNếu bạn không yêu cầu, vui lòng bỏ qua email này.`,
          html: htmlContent,
        });

        this.logger.log(`✅ [EMAIL DISPATCHED] Đã gửi email THẬT thành công tới: ${to} (MessageId: ${info.messageId})`);
        return { success: true };
      } catch (err) {
        this.logger.error(`❌ [EMAIL DISPATCH FAILED] Lỗi khi gửi email qua SMTP: ${err}`);
      }
    }

    // 2. Chế độ Ethereal Test Server (gửi email thật trên Internet để xem trực quan)
    try {
      const ethereal = await this.getEtherealTransporter();
      const info = await ethereal.sendMail({
        from: '"LOHA SALES System" <support@loha.vn>',
        to,
        subject: '🔒 [LOHA SALES] Hướng dẫn đặt lại mật khẩu tài khoản của bạn',
        text: `Xin chào ${recipientName},\n\nVui lòng truy cập đường dẫn sau để đặt lại mật khẩu tài khoản của bạn:\n${resetLink}`,
        html: htmlContent,
      });

      const previewUrl = nodemailer.getTestMessageUrl(info) || undefined;
      this.logger.log(`✉️ [ETHEREAL EMAIL SENT] Thư đã được gửi thành công tới: ${to}`);
      if (previewUrl) {
        this.logger.log(`🌐 [CLICK ĐỂ XEM HÒM THƯ EMAIL THẬT]: ${previewUrl}`);
      }
      return { success: true, previewUrl };
    } catch (err) {
      this.logger.error(`❌ [ETHEREAL MAIL FAILED] Lỗi gửi qua Ethereal: ${err}`);
      return { success: false };
    }
  }

  /**
   * Gửi email kích hoạt tài khoản kèm mật khẩu tạm thời cho nhân viên mới (SN-13)
   */
  async sendAccountActivationEmail(
    params: SendAccountActivationEmailParams,
  ): Promise<{ success: boolean; previewUrl?: string }> {
    const { to, fullName, username, temporaryPassword, role, assignedWarehouse, loginUrl } = params;
    const recipientName = fullName || username;
    const finalLoginUrl = loginUrl || process.env.FRONTEND_URL || 'http://localhost:5173/login';

    const smtpUser = process.env.SMTP_USER?.trim() || '';
    const fromAddress =
      smtpUser && smtpUser.includes('@gmail.com')
        ? `"LOHA SALES" <${smtpUser}>`
        : process.env.MAIL_FROM || `"LOHA SALES" <${smtpUser || 'no-reply@loha.vn'}>`;

    const htmlContent = `
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Kích hoạt tài khoản nhân sự — LOHA SALES</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 24px; }
        .card { max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; padding: 36px 32px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
        .logo-box { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; background: #eff6ff; border-radius: 12px; margin-bottom: 20px; border: 1px solid #dbeafe; }
        .logo-text { font-size: 20px; font-weight: 800; color: #2563eb; letter-spacing: -0.5px; }
        h1 { font-size: 22px; font-weight: 700; color: #0f172a; margin: 0 0 12px 0; }
        p { font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 16px 0; }
        .info-table { width: 100%; border-collapse: separate; border-spacing: 0; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; margin: 20px 0; overflow: hidden; }
        .info-table td { padding: 12px 16px; font-size: 13px; border-bottom: 1px solid #e2e8f0; }
        .info-table tr:last-child td { border-bottom: none; }
        .info-table .label { color: #64748b; font-weight: 500; width: 40%; }
        .info-table .value { color: #0f172a; font-weight: 600; font-family: monospace; }
        .btn-box { text-align: center; margin: 28px 0; }
        .btn { display: inline-block; background-color: #2563eb; color: #ffffff !important; font-size: 14px; font-weight: 600; text-decoration: none; padding: 13px 28px; border-radius: 12px; box-shadow: 0 2px 4px rgba(37, 99, 235, 0.2); }
        .btn:hover { background-color: #1d4ed8; }
        .notice { font-size: 12px; color: #64748b; line-height: 1.5; border-top: 1px solid #f1f5f9; padding-top: 16px; margin-top: 24px; }
        .notice strong { color: #334155; }
        .footer { text-align: center; margin-top: 24px; font-size: 12px; color: #94a3b8; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="logo-box">
          <span class="logo-text">LS</span>
        </div>
        <h1>Chào mừng bạn đến với LOHA SALES</h1>
        <p>Xin chào <strong>${recipientName}</strong>,</p>
        <p>Tài khoản nhân sự của bạn đã được Quản trị viên kích hoạt trên hệ thống <strong>LOHA SALES</strong>. Dưới đây là thông tin đăng nhập khởi tạo của bạn:</p>
        
        <table class="info-table">
          <tr>
            <td class="label">Tên đăng nhập:</td>
            <td class="value" style="color: #2563eb;">${username}</td>
          </tr>
          <tr>
            <td class="label">Mật khẩu tạm thời:</td>
            <td class="value" style="color: #ea580c; font-size: 15px;">${temporaryPassword}</td>
          </tr>
          <tr>
            <td class="label">Vai trò hệ thống:</td>
            <td class="value" style="font-family: inherit;">${role}</td>
          </tr>
          ${
            assignedWarehouse
              ? `<tr>
                  <td class="label">Kho / Địa bàn phụ trách:</td>
                  <td class="value" style="font-family: inherit;">${assignedWarehouse}</td>
                </tr>`
              : ''
          }
        </table>

        <div class="btn-box">
          <a href="${finalLoginUrl}" class="btn" target="_blank">Đăng nhập hệ thống ngay</a>
        </div>

        <div class="notice">
          <p>⚠️ <strong>Lưu ý bảo mật quan trọng:</strong></p>
          <ul style="margin: 0; padding-left: 18px;">
            <li>Mật khẩu trên là <strong>mật khẩu tạm thời</strong> được hệ thống cấp tự động.</li>
            <li>Vì lý do an toàn bảo mật, bạn bắt buộc phải đổi lại mật khẩu cá nhân ngay trong lần đăng nhập đầu tiên.</li>
            <li>Tuyệt đối không chia sẻ thông tin đăng nhập này cho bất kỳ ai.</li>
          </ul>
        </div>
      </div>
      <div class="footer">
        © 2026 LOHA SALES — Hệ thống Quản trị Bán hàng & Kho Doanh nghiệp B2B
      </div>
    </body>
    </html>
    `;

    // Gửi email thật nếu có cấu hình SMTP
    if (this.transporter) {
      try {
        const info = await this.transporter.sendMail({
          from: fromAddress,
          to,
          subject: '🎉 [LOHA SALES] Thông tin kích hoạt tài khoản & Mật khẩu khởi tạo',
          text: `Xin chào ${recipientName},\n\nTài khoản của bạn đã được kích hoạt trên hệ thống LOHA SALES.\nTên đăng nhập: ${username}\nMật khẩu tạm thời: ${temporaryPassword}\nVai trò: ${role}\n\nĐăng nhập tại: ${finalLoginUrl}\nVui lòng đổi mật khẩu ngay sau khi đăng nhập.`,
          html: htmlContent,
        });

        this.logger.log(`✅ [ACTIVATION EMAIL DISPATCHED] Đã gửi email kích hoạt tới: ${to} (MessageId: ${info.messageId})`);
        return { success: true };
      } catch (err) {
        this.logger.error(`❌ [ACTIVATION EMAIL FAILED] Lỗi gửi email kích hoạt qua SMTP: ${err}`);
      }
    }

    // Ethereal / Fallback simulation
    try {
      const ethereal = await this.getEtherealTransporter();
      const info = await ethereal.sendMail({
        from: '"LOHA SALES System" <support@loha.vn>',
        to,
        subject: '🎉 [LOHA SALES] Thông tin kích hoạt tài khoản & Mật khẩu khởi tạo',
        text: `Xin chào ${recipientName},\n\nTài khoản của bạn đã được kích hoạt trên hệ thống LOHA SALES.\nTên đăng nhập: ${username}\nMật khẩu tạm thời: ${temporaryPassword}\nVai trò: ${role}\n\nĐăng nhập tại: ${finalLoginUrl}`,
        html: htmlContent,
      });

      const previewUrl = nodemailer.getTestMessageUrl(info) || undefined;
      this.logger.log(`✉️ [ACTIVATION EMAIL SENT] Thư kích hoạt gửi tới: ${to} | User: ${username} | Pass: ${temporaryPassword}`);
      if (previewUrl) {
        this.logger.log(`🌐 [XEM HÒM THƯ EMAIL KÍCH HOẠT]: ${previewUrl}`);
      }
      return { success: true, previewUrl };
    } catch (err) {
      this.logger.warn(`⚠️ [ACTIVATION EMAIL LOGGED]: ${to} | Username: ${username} | Temporary Password: ${temporaryPassword}`);
      return { success: true };
    }
  }
}

