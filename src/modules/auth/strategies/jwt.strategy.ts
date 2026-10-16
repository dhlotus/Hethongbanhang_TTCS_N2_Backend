import { Inject, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserRole } from '../../../common/enums/user-role.enum';
import { UserStatus } from '../../../common/enums/user-status.enum';
import { jwtConfig } from '../../../config/jwt.config';
import { DatabaseService } from '../../../database/database.service';
import { UsersService } from '../../users/users.service';
import { AUTH_CONSTANTS } from '../constants/auth.constant';
import { ICurrentUser } from '../interfaces/current-user.interface';
import { IJwtPayload } from '../interfaces/jwt-payload.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @Inject(UsersService)
    @Optional()
    private readonly usersService?: UsersService,
    @Inject(DatabaseService)
    @Optional()
    private readonly dbService?: DatabaseService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtConfig.secret,
    });
  }

  /**
   * Xác thực và phân giải payload của Access Token
   * Kiểm tra trực tiếp trạng thái tài khoản: Nếu bị LOCKED, từ chối ngay lập tức!
   * Đồng thời tự động trích xuất agencyId / customerId từ Token cho Đại lý B2B
   */
  async validate(payload: IJwtPayload): Promise<ICurrentUser> {
    const roles = payload.roles ?? (payload.role ? [payload.role] : []);
    if (!payload || !payload.sub || roles.length === 0) {
      throw new UnauthorizedException(AUTH_CONSTANTS.UNAUTHORIZED_ACCESS_MESSAGE);
    }

    let avatarUrl: string | null = null;
    let customerId: string | null = null;
    let customerCode: string | null = null;
    let warehouseId: string | null = payload.warehouseId ?? null;
    let warehouseCode: string | null = payload.warehouseCode ?? null;
    let warehouseName: string | null = payload.warehouseName ?? payload.assignedWarehouse ?? null;
    let assignedWarehouse: string | null = payload.assignedWarehouse ?? null;
    let warehouses: Array<{ id: string; code: string; name: string; isPrimary?: boolean }> = [];

    if (this.usersService) {
      const user = await this.usersService.findById(payload.sub);
      if (user && user.status === UserStatus.LOCKED) {
        throw new UnauthorizedException(
          `Tài khoản của bạn đã bị khóa bởi Quản trị viên.${user.lockReason ? ' Lý do: ' + user.lockReason : ''}`,
        );
      }
      if (user) {
        avatarUrl = user.avatarUrl ?? null;
        customerId = user.customerId ?? null;
        customerCode = user.customerCode ?? null;
        warehouseId = warehouseId || user.warehouseId || (user as any).assignedWarehouseId || null;
        warehouseCode = warehouseCode || user.warehouseCode || (user as any).assignedWarehouseCode || null;
        assignedWarehouse = assignedWarehouse || user.assignedWarehouse || null;
        warehouseName = warehouseName || assignedWarehouse;
        warehouses = (user as any).warehouses || [];
      }
    }

    if (this.dbService?.isConnected()) {
      try {
        const whRes = await this.dbService.query<{ warehouse_id: string; code: string; name: string }>(
          `SELECT COALESCE(w.id, wm.id) as warehouse_id, COALESCE(w.code, wm.code) as code, COALESCE(w.name, wm.name) as name
           FROM user_warehouses uw
           JOIN warehouses w ON uw.warehouse_id = w.id
           FULL OUTER JOIN warehouses wm ON wm.manager_id = $1::uuid
           WHERE uw.user_id = $1::uuid OR uw.user_id::text = $1 OR wm.manager_id = $1::uuid OR wm.manager_id::text = $1
           ORDER BY uw.is_primary DESC
           LIMIT 1`,
          [payload.sub],
        );
        if (whRes[0]?.warehouse_id) {
          warehouseId = whRes[0].warehouse_id;
          warehouseCode = whRes[0].code;
          warehouseName = whRes[0].name;
          assignedWarehouse = whRes[0].name;
          warehouses = [{ id: warehouseId, code: warehouseCode || '', name: warehouseName || '', isPrimary: true }];
        }
      } catch {}
    }

    // Nếu người dùng có vai trò Đại lý (CUSTOMER) mà chưa có customerId, truy vấn DB hoặc file dữ liệu để tự động gắn
    const isCustomerRole = roles.includes(UserRole.CUSTOMER) || (roles as string[]).includes('CUSTOMER');
    if (isCustomerRole && !customerId) {
      if (this.dbService?.isConnected()) {
        try {
          const queryRes = await this.dbService.query<{ id: string; code: string }>(
            `SELECT id, code FROM customers WHERE user_id::text = $1 OR LOWER(email) = $2 LIMIT 1`,
            [payload.sub, (payload.email || '').toLowerCase().trim()],
          );
          if (queryRes.length > 0) {
            customerId = queryRes[0].id;
            customerCode = queryRes[0].code;
          }
        } catch (err) {
          // Fallback
        }
      }

      // Fallback tra cứu từ nguồn dữ liệu lưu trữ khách hàng (customers.json)
      if (!customerId) {
        try {
          const fs = await import('fs');
          const path = await import('path');
          const customersPath = path.join(process.cwd(), 'uploads', 'data', 'customers.json');
          if (fs.existsSync(customersPath)) {
            const list = JSON.parse(fs.readFileSync(customersPath, 'utf8'));
            const cleanEmail = (payload.email || '').toLowerCase().trim();
            const matched = list.find(
              (c: any) =>
                c.userId === payload.sub ||
                (c.email && c.email.toLowerCase().trim() === cleanEmail) ||
                (c.code && payload.username && c.code.toLowerCase() === payload.username.toLowerCase()),
            );
            if (matched) {
              customerId = matched.id;
              customerCode = matched.code;
            }
          }
        } catch {
          // Ignore
        }
      }
    }

    let warehouseIds: string[] =
      payload.warehouseIds ?? (warehouses.length > 0 ? warehouses.map((w) => w.id) : (warehouseId ? [warehouseId] : []));

    return {
      userId: payload.sub,
      email: payload.email,
      roles,
      username: payload.username,
      avatarUrl,
      customerId,
      customerCode,
      agencyId: customerId,
      warehouseId,
      warehouseCode,
      warehouseName,
      assignedWarehouse,
      warehouseIds,
      warehouses,
    };
  }
}

