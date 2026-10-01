import { BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '../src/common/enums/user-role.enum';
import { jwtConfig } from '../src/config/jwt.config';
import { AuthService } from '../src/modules/auth/auth.service';
import { MailService } from '../src/modules/mail/mail.service';
import { UsersService } from '../src/modules/users/users.service';

async function runSN14Tests(): Promise<void> {
  console.log('=== BẮT ĐẦU KIỂM THỬ SN-14: GÁN NHIỀU VAI TRÒ VÀ GẮN NGƯỜI DÙNG VỚI KHO/ĐỊA BÀN ===\n');

  let passedCount = 0;
  let failedCount = 0;

  function assert(condition: boolean, testName: string): void {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passedCount++;
    } else {
      console.error(`  ❌ FAIL: ${testName}`);
      failedCount++;
    }
  }

  const usersService = new UsersService();
  const mailService = new MailService();
  const jwtService = new JwtService({
    secret: jwtConfig.secret,
    signOptions: { expiresIn: jwtConfig.expiresIn },
  });
  const authService = new AuthService(usersService, jwtService, mailService);

  // -------------------------------------------------------------
  // Test 1: Tạo tài khoản với nhiều vai trò (Multi-role support)
  // -------------------------------------------------------------
  console.log('--- 1. Kiểm thử Tạo nhân sự Đa vai trò (Multi-role) ---');

  const createRes = await usersService.create({
    username: 'multirole_staff',
    email: 'multirole@loha.vn',
    fullName: 'Trần Đa Vai Trò',
    phone: '0901234567',
    roles: [UserRole.WAREHOUSE_MANAGER, UserRole.SALES_REP],
    assignedWarehouse: 'Kho Tổng Miền Nam - LOHA WH01',
    password: 'Password@2026',
  });
  const multiRoleUser = createRes.user;

  assert(Array.isArray(multiRoleUser.roles), 'User trả về có thuộc tính roles dạng mảng');
  assert(
    multiRoleUser.roles.includes(UserRole.WAREHOUSE_MANAGER) &&
      multiRoleUser.roles.includes(UserRole.SALES_REP),
    'User lưu trữ chính xác cả 2 vai trò: WAREHOUSE_MANAGER và SALES_REP',
  );
  assert(
    multiRoleUser.role === UserRole.WAREHOUSE_MANAGER,
    'Trường role mặc định là vai trò chính đầu tiên trong danh sách roles',
  );

  // Kiểm tra đăng nhập với tài khoản đa vai trò
  const loginRes = await authService.login({
    username: 'multirole_staff',
    password: 'Password@2026',
  });
  assert(
    loginRes.user.roles.includes(UserRole.WAREHOUSE_MANAGER) &&
      loginRes.user.roles.includes(UserRole.SALES_REP),
    'Phiên đăng nhập (AuthService.login) trả về đầy đủ các vai trò trong user.roles',
  );

  // -------------------------------------------------------------
  // Test 2: Ràng buộc cứng Kho (Business Validation)
  // -------------------------------------------------------------
  console.log('\n--- 2. Kiểm thử Ràng buộc cứng Kho cho vai trò Thủ kho / Quản lý kho ---');

  // 2.1 Tạo vai trò WAREHOUSE_KEEPER không có kho -> Phải trả về 400 Bad Request
  try {
    await usersService.create({
      username: 'warehouse_nokho',
      email: 'nokho@loha.vn',
      fullName: 'Nguyễn Không Kho',
      role: UserRole.WAREHOUSE_KEEPER,
      assignedWarehouse: '', // Không gán kho
    });
    assert(false, 'Hệ thống phải chặn khi tạo Thủ kho mà không gán kho');
  } catch (err: any) {
    assert(
      err instanceof BadRequestException &&
        err.message.includes('Nhân sự thuộc vai trò kho'),
      'Chặn thành công (400 Bad Request): Tạo Thủ kho bắt buộc phải có kho phụ trách',
    );
  }

  // 2.2 Tạo vai trò WAREHOUSE_MANAGER trong roles array không có kho -> Phải trả về 400 Bad Request
  try {
    await usersService.create({
      username: 'manager_nokho',
      email: 'managernokho@loha.vn',
      fullName: 'Lê Quản Lý Kho Thiếu Kho',
      roles: [UserRole.SALES_REP, UserRole.WAREHOUSE_MANAGER],
      assignedWarehouse: '   ', // Kho để khoảng trắng
    });
    assert(false, 'Hệ thống phải chặn khi mảng roles có vai trò kho mà không gán kho');
  } catch (err: any) {
    assert(
      err instanceof BadRequestException &&
        err.message.includes('Nhân sự thuộc vai trò kho'),
      'Chặn thành công (400 Bad Request): Đa vai trò có WAREHOUSE_MANAGER bắt buộc phải có kho phụ trách',
    );
  }

  // 2.3 Cập nhật nhân sự chuyển sang vai trò kho mà xóa bỏ kho -> Phải trả về 400 Bad Request
  try {
    await usersService.update(
      multiRoleUser.id,
      {
        roles: [UserRole.WAREHOUSE_KEEPER],
        assignedWarehouse: '',
      },
      { userId: 'admin-id', username: 'admin', roles: [UserRole.ADMIN] },
    );
    assert(false, 'Hệ thống phải chặn khi cập nhật vai trò kho mà xóa kho');
  } catch (err: any) {
    assert(
      err instanceof BadRequestException &&
        err.message.includes('Nhân sự thuộc vai trò kho'),
      'Chặn thành công (400 Bad Request): Cập nhật gán vai trò kho nhưng bỏ trống kho',
    );
  }

  // -------------------------------------------------------------
  // Test 3: Bảo mật Admin - Chặn tuyệt đối tự thu hồi quyền ADMIN
  // -------------------------------------------------------------
  console.log('\n--- 3. Kiểm thử Bảo mật Admin: Chặn tự thu hồi quyền Quản trị ---');

  // Tìm tài khoản admin đang tồn tại
  const adminEntity = await usersService.findByEmailOrUsername('admin');
  assert(adminEntity !== null && adminEntity.roles.includes(UserRole.ADMIN), 'Tìm thấy tài khoản admin hệ thống');

  // Admin đăng nhập tự cập nhật tài khoản của chính mình để gỡ bỏ quyền ADMIN
  try {
    await usersService.update(
      adminEntity!.id,
      {
        roles: [UserRole.SALES_REP], // Tự gỡ ADMIN, chỉ giữ SALES_REP
      },
      {
        userId: adminEntity!.id,
        username: adminEntity!.username,
        roles: [UserRole.ADMIN],
      },
    );
    assert(false, 'Hệ thống phải chặn tuyệt đối khi Admin tự tước quyền ADMIN của chính mình');
  } catch (err: any) {
    assert(
      err instanceof BadRequestException &&
        err.message.includes('Bạn không thể tự thu hồi quyền Quản trị hệ thống của chính mình'),
      'Chặn thành công (400 Bad Request): Không thể tự thu hồi quyền Quản trị hệ thống của chính mình',
    );
  }

  // Khi Admin cập nhật vai trò nhưng VẪN GIỮ vai trò ADMIN -> Phải thành công
  const adminUpdated = await usersService.update(
    adminEntity!.id,
    {
      roles: [UserRole.ADMIN, UserRole.SALES_MANAGER],
    },
    {
      userId: adminEntity!.id,
      username: adminEntity!.username,
      roles: [UserRole.ADMIN],
    },
  );
  assert(
    adminUpdated.roles.includes(UserRole.ADMIN) &&
      adminUpdated.roles.includes(UserRole.SALES_MANAGER),
    'Admin tự gán thêm vai trò SALES_MANAGER trong khi giữ nguyên ADMIN thành công',
  );

  // -------------------------------------------------------------
  // Test 4: Tìm kiếm & Lọc người dùng theo vai trò trong danh sách Đa vai trò
  // -------------------------------------------------------------
  console.log('\n--- 4. Kiểm thử Lọc người dùng theo vai trò (Hỗ trợ Đa vai trò) ---');

  const filterWarehouse = await usersService.findAll({
    role: UserRole.WAREHOUSE_MANAGER,
  });
  const hasUserInWarehouseFilter = filterWarehouse.data.some((u) => u.id === multiRoleUser.id);
  assert(
    hasUserInWarehouseFilter,
    'Lọc theo role WAREHOUSE_MANAGER tìm thấy user đa vai trò',
  );

  const filterSales = await usersService.findAll({
    role: UserRole.SALES_REP,
  });
  const hasUserInSalesFilter = filterSales.data.some((u) => u.id === multiRoleUser.id);
  assert(
    hasUserInSalesFilter,
    'Lọc theo role SALES_REP cũng tìm thấy user đa vai trò (tính năng lọc đa vai trò chuẩn)',
  );

  // -------------------------------------------------------------
  // Tổng kết kết quả
  // -------------------------------------------------------------
  console.log('\n======================================================');
  console.log(`KẾT QUẢ KIỂM THỬ SN-14: ${passedCount} PASS, ${failedCount} FAIL`);
  console.log('======================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runSN14Tests().catch((err) => {
  console.error('Lỗi thực thi kiểm thử SN-14:', err);
  process.exit(1);
});
