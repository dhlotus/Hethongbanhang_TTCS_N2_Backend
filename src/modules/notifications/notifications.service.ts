import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { NotificationEntity } from './entities/notification.entity';
import { CreateNotificationDto } from './dto';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';

interface TargetUser {
  id: string;
  username: string;
  fullName: string;
  roleName: string;
}

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private memoryNotifications: NotificationEntity[] = [];

  constructor(@Optional() private readonly databaseService?: DatabaseService) {}

  async onModuleInit(): Promise<void> {
    if (this.databaseService?.isConnected()) {
      try {
        await this.databaseService.query(`
          CREATE TABLE IF NOT EXISTS app_system_notifications (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id TEXT NOT NULL,
            recipient_name TEXT,
            recipient_role TEXT,
            order_id TEXT,
            order_code TEXT,
            customer_name TEXT,
            type TEXT NOT NULL DEFAULT 'ORDER',
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            amount NUMERIC,
            link TEXT NOT NULL DEFAULT '/sales/orders',
            is_read BOOLEAN NOT NULL DEFAULT FALSE,
            priority TEXT NOT NULL DEFAULT 'normal',
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
          );
          CREATE INDEX IF NOT EXISTS idx_app_notif_user_id ON app_system_notifications(user_id);
          CREATE INDEX IF NOT EXISTS idx_app_notif_created_at ON app_system_notifications(created_at DESC);
        `);
        this.logger.log('Đã khởi tạo bảng CSDL app_system_notifications thành công.');
      } catch (err) {
        this.logger.error(`Lỗi khởi tạo bảng notifications: ${err}`);
      }
    }
  }

  /**
   * Tạo thông báo cho một người dùng cụ thể
   */
  async createNotification(dto: CreateNotificationDto): Promise<NotificationEntity> {
    if (this.databaseService?.isConnected()) {
      const rows = await this.databaseService.query<any>(
        `INSERT INTO app_system_notifications (
          user_id, recipient_name, recipient_role, order_id, order_code,
          customer_name, type, title, message, amount, link, priority
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *;`,
        [
          dto.userId,
          dto.recipientName || null,
          dto.recipientRole || null,
          dto.orderId || null,
          dto.orderCode || null,
          dto.customerName || null,
          dto.type || 'ORDER',
          dto.title,
          dto.message,
          dto.amount || null,
          dto.link || '/sales/orders',
          dto.priority || 'normal',
        ],
      );

      const r = rows[0];
      return new NotificationEntity({
        id: r.id,
        userId: r.user_id,
        recipientName: r.recipient_name,
        recipientRole: r.recipient_role,
        orderId: r.order_id,
        orderCode: r.order_code,
        customerName: r.customer_name,
        type: r.type,
        title: r.title,
        message: r.message,
        amount: Number(r.amount) || 0,
        link: r.link,
        isRead: r.is_read,
        priority: r.priority,
        createdAt: new Date(r.created_at),
      });
    }

    const notif = new NotificationEntity({
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      ...dto,
      type: dto.type || 'ORDER',
      isRead: false,
      priority: dto.priority || 'normal',
      createdAt: new Date(),
    });
    this.memoryNotifications.unshift(notif);
    return notif;
  }

  /**
   * Phát thông báo xác nhận đặt đơn hàng B2B tới 5 nhóm đối tượng:
   * 1. Tất cả tài khoản Admin hệ thống (role_id = 1)
   * 2. Tất cả tài khoản Quản trị kinh doanh (role_id = 2)
   * 3. Tất cả tài khoản Quản lý kho (role_id = 4)
   * 4. Đúng 1 Nhân viên kinh doanh phụ trách đại lý đó
   * 5. Đúng 1 Thủ kho (nhân viên kho) phụ trách kho được gán vào đại lý
   */
  async notifyOrderCreated(order: {
    id: string;
    orderCode: string;
    customerId: string;
    customerName: string;
    grandTotal: number;
    lines?: any[];
    warehouseId?: string;
    salesRepId?: string;
    isCreditLimitExceeded?: boolean;
    status?: string;
  }): Promise<{ notifiedCount: number; recipients: string[] }> {
    const recipientsMap = new Map<string, TargetUser>();

    const amountFormatted = new Intl.NumberFormat('vi-VN', {
      style: 'currency',
      currency: 'VND',
    }).format(order.grandTotal || 0);

    const itemCount = order.lines?.length || 0;
    const statusText = order.isCreditLimitExceeded
      ? 'Chờ phê duyệt hạn mức'
      : 'Chờ xử lý xuất kho';

    const title = `Đơn hàng B2B mới từ ${order.customerName}`;
    const message = `Đại lý ${order.customerName} vừa đặt đơn hàng B2B [${order.orderCode}] gồm ${itemCount} sản phẩm, tổng thanh toán: ${amountFormatted}. Trạng thái: ${statusText}.`;

    if (this.databaseService?.isConnected()) {
      try {
        // 1. Lấy tất cả tài khoản Admin hệ thống (role_id = 1 hoặc role_name chứa admin/quản trị hệ thống)
        const admins = await this.databaseService.query<any>(
          `SELECT u.id, u.username, u.full_name, r.name as role_name
           FROM users u
           LEFT JOIN roles r ON r.id = u.role_id
           WHERE u.role_id = 1 OR r.name ILIKE '%quản trị hệ thống%' OR r.code ILIKE '%admin%';`,
        );
        for (const a of admins) {
          recipientsMap.set(String(a.id), {
            id: String(a.id),
            username: a.username,
            fullName: a.full_name,
            roleName: 'Quản trị hệ thống',
          });
        }

        // 2. Lấy tất cả tài khoản Quản trị kinh doanh (role_id = 2 hoặc role_name chứa quản lý kinh doanh)
        const salesManagers = await this.databaseService.query<any>(
          `SELECT u.id, u.username, u.full_name, r.name as role_name
           FROM users u
           LEFT JOIN roles r ON r.id = u.role_id
           WHERE u.role_id = 2 OR r.name ILIKE '%quản lý kinh doanh%' OR r.code ILIKE '%sales_manager%';`,
        );
        for (const sm of salesManagers) {
          recipientsMap.set(String(sm.id), {
            id: String(sm.id),
            username: sm.username,
            fullName: sm.full_name,
            roleName: 'Quản lý kinh doanh',
          });
        }

        // 3. Lấy tất cả tài khoản Quản lý kho (role_id = 4 hoặc role_name chứa quản lý kho)
        const warehouseManagers = await this.databaseService.query<any>(
          `SELECT u.id, u.username, u.full_name, r.name as role_name
           FROM users u
           LEFT JOIN roles r ON r.id = u.role_id
           WHERE u.role_id = 4 OR r.name ILIKE '%quản lý kho%' OR r.code ILIKE '%warehouse_manager%';`,
        );
        for (const wm of warehouseManagers) {
          recipientsMap.set(String(wm.id), {
            id: String(wm.id),
            username: wm.username,
            fullName: wm.full_name,
            roleName: 'Quản lý kho',
          });
        }

        // 4. Đúng 1 Nhân viên kinh doanh phụ trách đại lý đó
        let salesRepId = order.salesRepId;
        if (!salesRepId && order.customerId) {
          const custRows = await this.databaseService.query<any>(
            `SELECT sales_rep_id FROM customers WHERE id::text = $1 OR code = $1 LIMIT 1;`,
            [order.customerId],
          );
          salesRepId = custRows[0]?.sales_rep_id;
        }

        if (salesRepId) {
          const repRows = await this.databaseService.query<any>(
            `SELECT u.id, u.username, u.full_name, r.name as role_name
             FROM users u
             LEFT JOIN roles r ON r.id = u.role_id
             WHERE u.id::text = $1 OR u.username = $1 LIMIT 1;`,
            [salesRepId],
          );
          if (repRows[0]) {
            recipientsMap.set(String(repRows[0].id), {
              id: String(repRows[0].id),
              username: repRows[0].username,
              fullName: repRows[0].full_name,
              roleName: 'Nhân viên kinh doanh phụ trách',
            });
          }
        }

        // 5. Đúng 1 Thủ kho (nhân viên kho) phụ trách kho được gán vào đại lý
        let whId = order.warehouseId;
        if (!whId && order.customerId) {
          const agencyWh = await this.databaseService.query<any>(
            `SELECT warehouse_id FROM app_agency_default_warehouses WHERE agency_key = $1 LIMIT 1;`,
            [order.customerId],
          );
          whId = agencyWh[0]?.warehouse_id;
        }

        if (whId) {
          const whRows = await this.databaseService.query<any>(
            `SELECT manager_id FROM warehouses WHERE id::text = $1 OR code = $1 LIMIT 1;`,
            [whId],
          );
          const staffId = whRows[0]?.manager_id;
          if (staffId) {
            const staffRows = await this.databaseService.query<any>(
              `SELECT u.id, u.username, u.full_name, r.name as role_name
               FROM users u
               LEFT JOIN roles r ON r.id = u.role_id
               WHERE u.id::text = $1 OR u.username = $1 LIMIT 1;`,
              [staffId],
            );
            if (staffRows[0]) {
              recipientsMap.set(String(staffRows[0].id), {
                id: String(staffRows[0].id),
                username: staffRows[0].username,
                fullName: staffRows[0].full_name,
                roleName: 'Thủ kho phụ trách kho',
              });
            }
          }
        }
        // 6. Gửi thông báo cho chính Đại lý B2B vừa đặt đơn hàng
        const agencyUserIds = new Set<string>();
        if (order.customerId) {
          agencyUserIds.add(String(order.customerId));
          const custUserRows = await this.databaseService.query<any>(
            `SELECT user_id FROM customers WHERE id::text = $1 OR code = $1 LIMIT 1;`,
            [order.customerId],
          );
          if (custUserRows[0]?.user_id) {
            agencyUserIds.add(String(custUserRows[0].user_id));
          }
          const userRows = await this.databaseService.query<any>(
            `SELECT id FROM users WHERE id::text = $1 OR username = $1 LIMIT 1;`,
            [order.customerId],
          );
          if (userRows[0]?.id) {
            agencyUserIds.add(String(userRows[0].id));
          }
        }

        const agencyTitle = `Xác nhận đặt đơn thành công`;
        const agencyMessage = `Bạn đã gửi xác nhận đơn thành công [${order.orderCode}]. Tổng thanh toán: ${amountFormatted}. Đơn hàng đang được bộ phận kho vận xử lý.`;
        const agencyLink = `/portal/tracking?orderId=${order.id}`;

        for (const agId of agencyUserIds) {
          await this.createNotification({
            userId: agId,
            recipientName: order.customerName,
            recipientRole: 'Đại lý / Khách hàng B2B',
            orderId: order.id,
            orderCode: order.orderCode,
            customerName: order.customerName,
            type: 'ORDER',
            title: agencyTitle,
            message: agencyMessage,
            amount: order.grandTotal,
            link: agencyLink,
            priority: 'high',
          });
        }
      } catch (queryErr) {
        this.logger.error(`Lỗi khi truy vấn danh sách người nhận thông báo: ${queryErr}`);
      }
    }

    // Nếu bộ nhớ DB không có hoặc fallback
    if (recipientsMap.size === 0) {
      recipientsMap.set('admin-default', {
        id: 'admin-default',
        username: 'admin',
        fullName: 'Quản trị hệ thống',
        roleName: 'Quản trị hệ thống',
      });
    }

    const recipientLogs: string[] = [];

    // Gửi thông báo đến 5 nhóm tài khoản quản trị & nhân viên
    for (const [, target] of recipientsMap) {
      await this.createNotification({
        userId: target.id,
        recipientName: target.fullName,
        recipientRole: target.roleName,
        orderId: order.id,
        orderCode: order.orderCode,
        customerName: order.customerName,
        type: 'ORDER',
        title,
        message,
        amount: order.grandTotal,
        link: `/sales/orders?orderId=${order.id}`,
        priority: order.isCreditLimitExceeded ? 'high' : 'normal',
      });
      recipientLogs.push(`${target.fullName} (${target.username} - ${target.roleName})`);
    }

    this.logger.log(
      `Đã phát thông báo đơn hàng [${order.orderCode}] tới ${recipientsMap.size} tài khoản quản trị/nhân viên và Đại lý ${order.customerName}`,
    );

    return {
      notifiedCount: recipientsMap.size + 1,
      recipients: recipientLogs,
    };
  }

  /**
   * Lấy danh sách thông báo cho người dùng hiện tại theo phân quyền hoặc query parameters
   */
  async getNotificationsForUser(
    user?: ICurrentUser,
    query?: { limit?: string; userId?: string; role?: string; customerId?: string; username?: string },
  ): Promise<NotificationEntity[]> {
    const limit = query?.limit ? parseInt(query.limit, 10) : 50;

    if (this.databaseService?.isConnected()) {
      const explicitUserId = query?.userId || user?.userId || user?.username || query?.username;
      const explicitRole = (query?.role || user?.roles?.[0] || '').toUpperCase();
      const explicitCustomerId = query?.customerId || user?.agencyId || user?.customerId;

      let rows: any[] = [];

      // 1. Nếu là Đại lý / Khách hàng B2B (Cổng portal) - CHỈ hiển thị đúng thông báo của đại lý đó
      if (
        explicitRole.includes('CUSTOMER') ||
        explicitRole.includes('AGENCY') ||
        explicitCustomerId
      ) {
        const agencyIdentifiers = new Set<string>();
        if (explicitUserId) agencyIdentifiers.add(String(explicitUserId).trim());
        if (explicitCustomerId) agencyIdentifiers.add(String(explicitCustomerId).trim());
        if (user?.username) agencyIdentifiers.add(String(user.username).trim());
        if (query?.username) agencyIdentifiers.add(String(query.username).trim());

        // Tra cứu thêm các định danh liên kết (code, id, user_id) nếu có kết nối DB
        if (explicitCustomerId || explicitUserId) {
          try {
            const matchedCustomers = await this.databaseService.query<any>(
              `SELECT id, code, user_id FROM customers WHERE id::text = $1 OR code = $1 OR user_id::text = $1 OR id::text = $2 OR code = $2 OR user_id::text = $2;`,
              [explicitCustomerId || explicitUserId, explicitUserId || explicitCustomerId],
            );
            for (const mc of matchedCustomers || []) {
              if (mc.id) agencyIdentifiers.add(String(mc.id).trim());
              if (mc.code) agencyIdentifiers.add(String(mc.code).trim());
              if (mc.user_id) agencyIdentifiers.add(String(mc.user_id).trim());
            }
          } catch {}
        }

        const idList = Array.from(agencyIdentifiers).filter(Boolean);
        const querySql = `
          SELECT * FROM app_system_notifications
          WHERE (
            user_id = ANY($1::text[]) OR
            user_id = 'ALL' OR
            user_id = 'BROADCAST'
          )
          ORDER BY created_at DESC LIMIT $2;
        `;
        rows = await this.databaseService.query<any>(querySql, [idList, limit]);
      }
      // 2. Nếu là Admin hoặc Quản trị kinh doanh
      else if (
        explicitRole.includes('ADMIN') ||
        explicitRole.includes('SALES_MANAGER') ||
        explicitRole.includes('SALES_ADMIN')
      ) {
        const querySql = `
          SELECT * FROM app_system_notifications
          WHERE (
            ($1::text IS NOT NULL AND user_id = $1) OR
            recipient_role ILIKE '%quản trị%' OR
            recipient_role ILIKE '%kinh doanh%' OR
            recipient_role ILIKE '%admin%'
          )
          ORDER BY created_at DESC LIMIT $2;
        `;
        rows = await this.databaseService.query<any>(querySql, [explicitUserId || null, limit]);
      }
      // 3. Nếu là Quản lý kho
      else if (
        explicitRole.includes('INVENTORY') ||
        explicitRole.includes('WAREHOUSE_MANAGER')
      ) {
        const querySql = `
          SELECT * FROM app_system_notifications
          WHERE (
            ($1::text IS NOT NULL AND user_id = $1) OR
            recipient_role ILIKE '%quản lý kho%' OR
            recipient_role ILIKE '%kho%'
          )
          ORDER BY created_at DESC LIMIT $2;
        `;
        rows = await this.databaseService.query<any>(querySql, [explicitUserId || null, limit]);
      }
      // 4. Nếu là Thủ kho
      else if (explicitRole.includes('KEEPER') || explicitRole.includes('STAFF')) {
        const querySql = `
          SELECT * FROM app_system_notifications
          WHERE (
            ($1::text IS NOT NULL AND user_id = $1) OR
            recipient_role ILIKE '%thủ kho%'
          )
          ORDER BY created_at DESC LIMIT $2;
        `;
        rows = await this.databaseService.query<any>(querySql, [explicitUserId || null, limit]);
      }
      // 5. Nếu là Kế toán công nợ (ACCOUNTANT)
      else if (explicitRole.includes('ACCOUNT')) {
        const querySql = `
          SELECT * FROM app_system_notifications
          WHERE (
            ($1::text IS NOT NULL AND user_id = $1) OR
            recipient_role ILIKE '%kế toán%' OR
            recipient_role ILIKE '%công nợ%' OR
            type = 'COLLECTION'
          )
          ORDER BY created_at DESC LIMIT $2;
        `;
        rows = await this.databaseService.query<any>(querySql, [explicitUserId || null, limit]);
      }
      // 6. Nếu là Nhân viên kinh doanh
      else if (explicitRole.includes('SALES_REP') || explicitRole.includes('REP')) {
        const querySql = `
          SELECT * FROM app_system_notifications
          WHERE (
            ($1::text IS NOT NULL AND user_id = $1) OR
            recipient_role ILIKE '%kinh doanh phụ trách%'
          )
          ORDER BY created_at DESC LIMIT $2;
        `;
        rows = await this.databaseService.query<any>(querySql, [explicitUserId || null, limit]);
      }
      // 7. Nếu có userId cụ thể
      else if (explicitUserId) {
        const querySql = `
          SELECT * FROM app_system_notifications
          WHERE user_id = $1
          ORDER BY created_at DESC LIMIT $2;
        `;
        rows = await this.databaseService.query<any>(querySql, [explicitUserId, limit]);
      }

      // Fallback an toàn: Chỉ áp dụng cho người dùng nội bộ/khách nếu không có thông báo riêng, TUYỆT ĐỐI KHÔNG áp dụng cho Đại lý
      const isAgencyUser =
        explicitRole.includes('CUSTOMER') ||
        explicitRole.includes('AGENCY') ||
        Boolean(explicitCustomerId);

      if (!isAgencyUser && (!rows || rows.length === 0)) {
        rows = await this.databaseService.query<any>(
          `SELECT * FROM app_system_notifications ORDER BY created_at DESC LIMIT $1;`,
          [limit],
        );
      }

      return (rows || []).map((r) => this.mapDbRowToEntity(r));
    }

    const userId = user?.userId || query?.userId || 'admin';
    return this.memoryNotifications.filter((n) => n.userId === userId || userId === 'admin');
  }

  private mapDbRowToEntity(r: any): NotificationEntity {
    return new NotificationEntity({
      id: r.id,
      userId: r.user_id,
      recipientName: r.recipient_name,
      recipientRole: r.recipient_role,
      orderId: r.order_id,
      orderCode: r.order_code,
      customerName: r.customer_name,
      type: r.type,
      title: r.title,
      message: r.message,
      amount: Number(r.amount) || 0,
      link: r.link,
      isRead: r.is_read,
      priority: r.priority,
      createdAt: new Date(r.created_at),
    });
  }

  /**
   * Đánh dấu đã đọc một thông báo
   */
  async markAsRead(id: string, user?: ICurrentUser): Promise<boolean> {
    if (this.databaseService?.isConnected()) {
      await this.databaseService.query(
        `UPDATE app_system_notifications SET is_read = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id::text = $1;`,
        [id],
      );
      return true;
    }
    const found = this.memoryNotifications.find((n) => n.id === id);
    if (found) found.isRead = true;
    return true;
  }

  /**
   * Đánh dấu tất cả đã đọc
   */
  async markAllAsRead(user?: ICurrentUser): Promise<boolean> {
    const userId = user?.userId || user?.username;
    if (this.databaseService?.isConnected()) {
      if (userId) {
        await this.databaseService.query(
          `UPDATE app_system_notifications SET is_read = TRUE, updated_at = CURRENT_TIMESTAMP WHERE user_id = $1;`,
          [userId],
        );
      } else {
        await this.databaseService.query(
          `UPDATE app_system_notifications SET is_read = TRUE, updated_at = CURRENT_TIMESTAMP;`,
        );
      }
      return true;
    }
    return true;
  }

  /**
   * SN-188: Sự kiện 1: Phát thông báo khi tạo phiếu xuất chuẩn FEFO
   * Đối tượng nhận: Nhân viên kho phụ trách & Quản lý kho.
   * Nội dung: "Phiếu xuất mới [ma_phieu] đã được tạo theo chuẩn FEFO cho lô [batch_no]."
   */
  async notifyShipmentFefoCreated(data: {
    shipmentId: string;
    orderCode: string;
    batchNumbers: string[];
    warehouseId?: string;
    creatorId?: string;
    creatorName?: string;
    creatorUsername?: string;
  }): Promise<void> {
    const recipientsMap = new Map<string, TargetUser>();
    const batchText = data.batchNumbers.length > 0 ? data.batchNumbers.join(', ') : 'mặc định';
    const title = `Phiếu xuất kho mới theo chuẩn FEFO`;
    const message = `Phiếu xuất mới ${data.shipmentId} đã được tạo theo chuẩn FEFO cho lô ${batchText}.`;
    const link = `/inventory/shipments/${data.shipmentId}`;

    if (this.databaseService?.isConnected()) {
      try {
        // 1. Quản lý kho (role_id = 4 hoặc tên chứa quản lý kho)
        const whManagers = await this.databaseService.query<any>(
          `SELECT u.id, u.username, u.full_name, r.name as role_name
           FROM users u
           LEFT JOIN roles r ON r.id = u.role_id
           WHERE u.role_id = 4 OR r.name ILIKE '%quản lý kho%' OR r.code ILIKE '%warehouse_manager%';`,
        );
        for (const wm of whManagers) {
          recipientsMap.set(String(wm.id), {
            id: String(wm.id),
            username: wm.username,
            fullName: wm.full_name,
            roleName: 'Quản lý kho',
          });
        }

        // 2. Nhân viên kho / Thủ kho (role_id = 5 hoặc phụ trách kho)
        if (data.warehouseId) {
          const keepers = await this.databaseService.query<any>(
            `SELECT u.id, u.username, u.full_name, r.name as role_name
             FROM users u
             LEFT JOIN roles r ON r.id = u.role_id
             WHERE (u.warehouse_id = $1 OR u.role_id = 5 OR r.name ILIKE '%thủ kho%')
             LIMIT 5;`,
            [data.warehouseId],
          );
          for (const k of keepers) {
            recipientsMap.set(String(k.id), {
              id: String(k.id),
              username: k.username,
              fullName: k.full_name,
              roleName: 'Thủ kho phụ trách',
            });
          }
        }
      } catch (err) {
        this.logger.error(`Lỗi tìm người nhận thông báo FEFO: ${err}`);
      }
    }

    // Gửi thông báo đến danh sách người nhận (Quản lý kho & Thủ kho phụ trách)
    for (const [, target] of recipientsMap) {
      await this.createNotification({
        userId: target.id,
        recipientName: target.fullName,
        recipientRole: target.roleName,
        orderCode: data.orderCode,
        type: 'STOCK_ALERT',
        title,
        message,
        link,
        priority: 'normal',
      });
    }

    // 3. THÔNG BÁO CÁ NHÂN: Gửi thông báo trực tiếp cho chính Thủ kho vừa tạo phiếu để xem lại
    if (data.creatorId || data.creatorUsername) {
      const creatorKey = String(data.creatorId || data.creatorUsername);
      await this.createNotification({
        userId: creatorKey,
        recipientName: data.creatorName || 'Bạn',
        recipientRole: 'Thủ kho tạo phiếu',
        orderCode: data.orderCode,
        type: 'STOCK_ALERT',
        title: 'Tạo phiếu xuất kho thành công',
        message: `Bạn đã tạo thành công phiếu xuất kho [${data.shipmentId}] cho đơn hàng [${data.orderCode}]. Hàng hóa đã được phân bổ lô xuất kho chuẩn FEFO.`,
        link,
        priority: 'high',
      });
    }
  }

  /**
   * SN-188: Sự kiện 2: Phát thông báo Cảnh báo ghi đè lô xuất kho (FEFO Override)
   * Đối tượng nhận: Quản lý kho & Admin (Quản trị hệ thống).
   * Nội dung: "⚠️ Cảnh báo ghi đè lô xuất kho: Thủ kho [ten_thu_kho] vừa đổi lô sản phẩm [sku] từ [lo_goi_y] sang [lo_thuc_te]. Lý do: [override_reason]."
   */
  async notifyShipmentBatchOverridden(data: {
    shipmentId: string;
    orderCode: string;
    keeperName: string;
    sku: string;
    suggestedBatch: string;
    actualBatch: string;
    reason: string;
    creatorId?: string;
    creatorUsername?: string;
  }): Promise<void> {
    const recipientsMap = new Map<string, TargetUser>();
    const title = `⚠️ Cảnh báo ghi đè lô xuất kho`;
    const message = `⚠️ Cảnh báo ghi đè lô xuất kho: Thủ kho ${data.keeperName || 'Thủ kho'} vừa đổi lô sản phẩm ${data.sku} từ ${data.suggestedBatch || 'FEFO'} sang ${data.actualBatch}. Lý do: ${data.reason}.`;
    const link = `/inventory/shipments/${data.shipmentId}`;

    if (this.databaseService?.isConnected()) {
      try {
        // 1. Quản trị hệ thống (Admin)
        const admins = await this.databaseService.query<any>(
          `SELECT u.id, u.username, u.full_name, r.name as role_name
           FROM users u
           LEFT JOIN roles r ON r.id = u.role_id
           WHERE u.role_id = 1 OR r.name ILIKE '%quản trị hệ thống%' OR r.code ILIKE '%admin%';`,
        );
        for (const a of admins) {
          recipientsMap.set(String(a.id), {
            id: String(a.id),
            username: a.username,
            fullName: a.full_name,
            roleName: 'Quản trị hệ thống',
          });
        }

        // 2. Quản lý kho
        const whManagers = await this.databaseService.query<any>(
          `SELECT u.id, u.username, u.full_name, r.name as role_name
           FROM users u
           LEFT JOIN roles r ON r.id = u.role_id
           WHERE u.role_id = 4 OR r.name ILIKE '%quản lý kho%' OR r.code ILIKE '%warehouse_manager%';`,
        );
        for (const wm of whManagers) {
          recipientsMap.set(String(wm.id), {
            id: String(wm.id),
            username: wm.username,
            fullName: wm.full_name,
            roleName: 'Quản lý kho',
          });
        }
      } catch (err) {
        this.logger.error(`Lỗi tìm người nhận cảnh báo ghi đè lô: ${err}`);
      }
    }

    // Gửi thông báo đến danh sách người nhận
    for (const [, target] of recipientsMap) {
      await this.createNotification({
        userId: target.id,
        recipientName: target.fullName,
        recipientRole: target.roleName,
        orderCode: data.orderCode,
        type: 'STOCK_ALERT',
        title,
        message,
        link,
        priority: 'high',
      });
    }

    // THÔNG BÁO CÁ NHÂN: Gửi cho chính người tạo phiếu
    if (data.creatorId || data.creatorUsername) {
      const creatorKey = String(data.creatorId || data.creatorUsername);
      await this.createNotification({
        userId: creatorKey,
        recipientName: data.keeperName || 'Bạn',
        recipientRole: 'Thủ kho tạo phiếu',
        orderCode: data.orderCode,
        type: 'STOCK_ALERT',
        title: 'Tạo phiếu xuất kho (Ghi đè FEFO)',
        message: `Bạn đã tạo thành công phiếu xuất kho [${data.shipmentId}] cho đơn hàng [${data.orderCode}] với yêu cầu ghi đè lô xuất kho cho sản phẩm ${data.sku}.`,
        link,
        priority: 'high',
      });
    }
  }

  /**
   * SN-205: Phát thông báo khi có phiếu thu tiền tuyến mới tới các bên liên quan:
   * 1. Tất cả tài khoản Admin hệ thống (role_id = 1)
   * 2. Tất cả tài khoản Kế toán công nợ (role_id = 6) để đối chiếu và duyệt gạch nợ
   * 3. Tất cả tài khoản Quản lý kinh doanh (role_id = 2) để giám sát dòng tiền
   * 4. Nhân viên kinh doanh thu tiền / phụ trách
   * 5. Đại lý B2B nhận tiền
   */
  async notifyCollectionCreated(collection: {
    id: string;
    code: string;
    agencyId: string;
    agencyName: string;
    salesRepId: string;
    salesRepName: string;
    amount: number;
    paymentMethod: string;
    status?: string;
  }): Promise<{ notifiedCount: number; recipients: string[] }> {
    const recipientsMap = new Map<string, TargetUser>();

    const amountFormatted = new Intl.NumberFormat('vi-VN', {
      style: 'currency',
      currency: 'VND',
    }).format(collection.amount || 0);

    const methodText = collection.paymentMethod === 'BANK_TRANSFER' ? 'Chuyển khoản' : 'Tiền mặt';

    const title = `Phiếu thu tiền tuyến mới [${collection.code}]`;
    const message = `Nhân viên ${collection.salesRepName} vừa lập phiếu thu ${amountFormatted} (${methodText}) từ đại lý "${collection.agencyName}". Cần Kế toán đối chiếu và duyệt gạch nợ.`;
    const link = `/route-collections`;

    if (this.databaseService?.isConnected()) {
      try {
        // 1. Tất cả Admin hệ thống (role_id = 1 hoặc role_name chứa admin/quản trị hệ thống)
        const admins = await this.databaseService.query<any>(
          `SELECT u.id, u.username, u.full_name, r.name as role_name
           FROM users u
           LEFT JOIN roles r ON r.id = u.role_id
           WHERE u.role_id = 1 OR r.name ILIKE '%quản trị hệ thống%' OR r.code ILIKE '%admin%';`,
        );
        for (const a of admins) {
          recipientsMap.set(String(a.id), {
            id: String(a.id),
            username: a.username,
            fullName: a.full_name,
            roleName: 'Quản trị hệ thống',
          });
        }

        // 2. Tất cả Kế toán công nợ (role_id = 6 hoặc role_name/code chứa kế toán/accountant)
        const accountants = await this.databaseService.query<any>(
          `SELECT u.id, u.username, u.full_name, r.name as role_name
           FROM users u
           LEFT JOIN roles r ON r.id = u.role_id
           WHERE u.role_id = 6 OR r.name ILIKE '%kế toán%' OR r.code ILIKE '%accountant%';`,
        );
        for (const acc of accountants) {
          recipientsMap.set(String(acc.id), {
            id: String(acc.id),
            username: acc.username,
            fullName: acc.full_name,
            roleName: 'Kế toán công nợ',
          });
        }

        // 3. Tất cả Quản lý kinh doanh (role_id = 2 hoặc role_name/code chứa sales_manager/quản lý kinh doanh)
        const salesManagers = await this.databaseService.query<any>(
          `SELECT u.id, u.username, u.full_name, r.name as role_name
           FROM users u
           LEFT JOIN roles r ON r.id = u.role_id
           WHERE u.role_id = 2 OR r.name ILIKE '%quản lý kinh doanh%' OR r.code ILIKE '%sales_manager%';`,
        );
        for (const sm of salesManagers) {
          recipientsMap.set(String(sm.id), {
            id: String(sm.id),
            username: sm.username,
            fullName: sm.full_name,
            roleName: 'Quản lý kinh doanh',
          });
        }

        // 4. Nhân viên kinh doanh thu tiền
        if (collection.salesRepId) {
          const repRows = await this.databaseService.query<any>(
            `SELECT u.id, u.username, u.full_name, r.name as role_name
             FROM users u
             LEFT JOIN roles r ON r.id = u.role_id
             WHERE u.id::text = $1 OR u.username = $1 LIMIT 1;`,
            [collection.salesRepId],
          );
          if (repRows[0]) {
            recipientsMap.set(String(repRows[0].id), {
              id: String(repRows[0].id),
              username: repRows[0].username,
              fullName: repRows[0].full_name,
              roleName: 'Nhân viên thu tiền',
            });
          }
        }

        // 5. Gửi thông báo cho Đại lý B2B
        const agencyUserIds = new Set<string>();
        if (collection.agencyId) {
          agencyUserIds.add(String(collection.agencyId));
          const custUserRows = await this.databaseService.query<any>(
            `SELECT user_id FROM customers WHERE id::text = $1 OR code = $1 LIMIT 1;`,
            [collection.agencyId],
          );
          if (custUserRows[0]?.user_id) {
            agencyUserIds.add(String(custUserRows[0].user_id));
          }
          const userRows = await this.databaseService.query<any>(
            `SELECT id FROM users WHERE id::text = $1 OR username = $1 LIMIT 1;`,
            [collection.agencyId],
          );
          if (userRows[0]?.id) {
            agencyUserIds.add(String(userRows[0].id));
          }
        }

        const agencyTitle = `Xác nhận nộp tiền [${collection.code}]`;
        const agencyMessage = `Nhân viên kinh doanh đã tiếp nhận số tiền ${amountFormatted} (${methodText}) của đại lý và gửi phiếu thu lên hệ thống. Đang chờ Kế toán duyệt gạch nợ.`;
        for (const agId of agencyUserIds) {
          await this.createNotification({
            userId: agId,
            recipientName: collection.agencyName,
            recipientRole: 'Đại lý / Khách hàng B2B',
            orderCode: collection.code,
            customerName: collection.agencyName,
            type: 'COLLECTION',
            title: agencyTitle,
            message: agencyMessage,
            amount: collection.amount,
            link: `/portal/debt`,
            priority: 'high',
          });
        }
      } catch (err) {
        this.logger.error(`Lỗi tìm người nhận thông báo phiếu thu: ${err}`);
      }
    }

    if (recipientsMap.size === 0) {
      recipientsMap.set('admin-default', {
        id: 'admin-default',
        username: 'admin',
        fullName: 'Quản trị hệ thống',
        roleName: 'Quản trị hệ thống',
      });
    }

    for (const [, target] of recipientsMap) {
      await this.createNotification({
        userId: target.id,
        recipientName: target.fullName,
        recipientRole: target.roleName,
        orderCode: collection.code,
        customerName: collection.agencyName,
        type: 'COLLECTION',
        title,
        message,
        amount: collection.amount,
        link,
        priority: 'high',
      });
    }

    this.logger.log(
      `Đã phát thông báo phiếu thu [${collection.code}] tới ${recipientsMap.size} tài khoản quản trị/kế toán/kinh doanh và Đại lý ${collection.agencyName}`,
    );

    return {
      notifiedCount: recipientsMap.size,
      recipients: Array.from(recipientsMap.values()).map(
        (t) => `${t.fullName} (${t.username} - ${t.roleName})`,
      ),
    };
  }

  /**
   * SN-205: Phát thông báo khi Kế toán Duyệt hoặc Từ chối phiếu thu tiền
   */
  async notifyCollectionStatusUpdated(data: {
    id: string;
    code: string;
    agencyId: string;
    agencyName: string;
    salesRepId: string;
    salesRepName: string;
    amount: number;
    paymentMethod: string;
    status: 'APPROVED' | 'REJECTED';
    approverName?: string;
    rejectionReason?: string;
  }): Promise<void> {
    const isApproved = data.status === 'APPROVED';
    const amountFormatted = new Intl.NumberFormat('vi-VN', {
      style: 'currency',
      currency: 'VND',
    }).format(data.amount || 0);

    const title = isApproved
      ? `Phiếu thu [${data.code}] đã được duyệt gạch nợ`
      : `Phiếu thu [${data.code}] bị từ chối`;

    const message = isApproved
      ? `Kế toán ${data.approverName || ''} đã duyệt phiếu thu ${amountFormatted} của đại lý "${data.agencyName}". Hệ thống đã tự động gạch nợ.`
      : `Kế toán ${data.approverName || ''} đã từ chối phiếu thu ${amountFormatted} của đại lý "${data.agencyName}". Lý do: ${data.rejectionReason || 'Không hợp lệ'}.`;

    const recipientsMap = new Map<string, TargetUser>();

    if (this.databaseService?.isConnected()) {
      try {
        // 1. Admin
        const admins = await this.databaseService.query<any>(
          `SELECT u.id, u.username, u.full_name, r.name as role_name
           FROM users u
           LEFT JOIN roles r ON r.id = u.role_id
           WHERE u.role_id = 1 OR r.name ILIKE '%quản trị hệ thống%' OR r.code ILIKE '%admin%';`,
        );
        for (const a of admins) {
          recipientsMap.set(String(a.id), {
            id: String(a.id),
            username: a.username,
            fullName: a.full_name,
            roleName: 'Quản trị hệ thống',
          });
        }

        // 2. Quản lý kinh doanh
        const salesManagers = await this.databaseService.query<any>(
          `SELECT u.id, u.username, u.full_name, r.name as role_name
           FROM users u
           LEFT JOIN roles r ON r.id = u.role_id
           WHERE u.role_id = 2 OR r.name ILIKE '%quản lý kinh doanh%' OR r.code ILIKE '%sales_manager%';`,
        );
        for (const sm of salesManagers) {
          recipientsMap.set(String(sm.id), {
            id: String(sm.id),
            username: sm.username,
            fullName: sm.full_name,
            roleName: 'Quản lý kinh doanh',
          });
        }

        // 3. Nhân viên thu tiền
        if (data.salesRepId) {
          const repRows = await this.databaseService.query<any>(
            `SELECT u.id, u.username, u.full_name, r.name as role_name
             FROM users u
             LEFT JOIN roles r ON r.id = u.role_id
             WHERE u.id::text = $1 OR u.username = $1 LIMIT 1;`,
            [data.salesRepId],
          );
          if (repRows[0]) {
            recipientsMap.set(String(repRows[0].id), {
              id: String(repRows[0].id),
              username: repRows[0].username,
              fullName: repRows[0].full_name,
              roleName: 'Nhân viên thu tiền',
            });
          }
        }
      } catch (err) {
        this.logger.error(`Lỗi tìm người nhận thông báo cập nhật phiếu thu: ${err}`);
      }
    }

    for (const [, target] of recipientsMap) {
      await this.createNotification({
        userId: target.id,
        recipientName: target.fullName,
        recipientRole: target.roleName,
        orderCode: data.code,
        customerName: data.agencyName,
        type: 'COLLECTION',
        title,
        message,
        amount: data.amount,
        link: `/route-collections`,
        priority: isApproved ? 'normal' : 'high',
      });
    }
  }
}


