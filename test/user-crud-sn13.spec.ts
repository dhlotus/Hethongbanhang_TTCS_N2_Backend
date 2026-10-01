import { BadRequestException } from '@nestjs/common';
import { UserRole } from '../src/common/enums/user-role.enum';
import { UserStatus } from '../src/common/enums/user-status.enum';
import { MailService } from '../src/modules/mail/mail.service';
import { UsersService } from '../src/modules/users/users.service';

async function runSN13Tests(): Promise<void> {
  console.log('=== BẮT ĐẦU KIỂM THỬ SN-13: QUẢN LÝ TẠO, SỬA VÀ TÌM KIẾM TÀI KHOẢN NGƯỜI DÙNG ===\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, title: string): void {
    if (condition) {
      console.log(`  ✅ PASS: ${title}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${title}`);
      failed++;
    }
  }

  const mailService = new MailService();
  const usersService = new UsersService(mailService);

  // -------------------------------------------------------------
  // Test 1: Kiểm tra trùng lặp khi tạo mới (POST /api/users)
  // -------------------------------------------------------------
  console.log('--- 1. Kiểm thử phát hiện trùng lặp tài khoản khi tạo mới ---');

  // Trùng Username
  try {
    await usersService.create({
      fullName: 'Trùng Tên Đăng Nhập',
      username: 'admin', // đã tồn tại
      email: 'unique_email_1@loha.vn',
      role: UserRole.SALES_REP,
    });
    assert(false, 'Phải ném lỗi khi username trùng');
  } catch (err: any) {
    assert(
      err instanceof BadRequestException &&
        err.message.includes('Tên đăng nhập hoặc email đã tồn tại trên hệ thống') &&
        err.message.includes('Tên đăng nhập "admin"'),
      'Từ chối khi username trùng lặp: trả về 400 Bad Request kèm thông điệp cụ thể rõ ràng',
    );
  }

  // Trùng Email
  try {
    await usersService.create({
      fullName: 'Trùng Email',
      username: 'unique_user_1',
      email: 'admin@loha.vn', // đã tồn tại
      role: UserRole.SALES_REP,
    });
    assert(false, 'Phải ném lỗi khi email trùng');
  } catch (err: any) {
    assert(
      err instanceof BadRequestException &&
        err.message.includes('Tên đăng nhập hoặc email đã tồn tại trên hệ thống') &&
        err.message.includes('Địa chỉ email "admin@loha.vn"'),
      'Từ chối khi email trùng lặp: trả về 400 Bad Request kèm thông điệp cụ thể rõ ràng',
    );
  }

  // -------------------------------------------------------------
  // Test 2: Mật khẩu tạm & Email kích hoạt khi tạo thành công
  // -------------------------------------------------------------
  console.log('\n--- 2. Kiểm thử Mật khẩu tạm & Email kích hoạt tài khoản ---');

  let emailSentParams: any = null;
  // Mock mailService.sendAccountActivationEmail to verify call
  mailService.sendAccountActivationEmail = async (params: any) => {
    emailSentParams = params;
    return { success: true };
  };

  const createdUser = await usersService.create({
    fullName: 'Hoàng Kim Chi',
    username: 'hoang_chi_sales',
    email: 'kimchi.hoang@loha.vn',
    phone: '0988776655',
    role: UserRole.SALES_REP,
    assignedWarehouse: 'Địa bàn TP. Hồ Chí Minh',
  });

  assert(Boolean(createdUser.temporaryPassword), 'Tự động sinh mật khẩu tạm thời an toàn khi không nhập');
  assert(
    createdUser.temporaryPassword!.startsWith('Loha@'),
    'Mật khẩu tạm thời tuân thủ quy chuẩn bảo mật (bắt đầu bằng Loha@ và chữ số)',
  );
  assert(createdUser.user.username === 'hoang_chi_sales', 'User được lưu với username chuẩn');
  assert(createdUser.user.role === UserRole.SALES_REP, 'User được gán vai trò SALES_REP chuẩn');

  assert(Boolean(emailSentParams), 'Dịch vụ MailService.sendAccountActivationEmail được gọi tự động');
  assert(emailSentParams?.to === 'kimchi.hoang@loha.vn', 'Email gửi tới đúng hòm thư nhân viên');
  assert(emailSentParams?.temporaryPassword === createdUser.temporaryPassword, 'Email mang mật khẩu tạm khớp chính xác');

  // -------------------------------------------------------------
  // Test 3: Kiểm tra trùng lặp khi cập nhật (PATCH /api/users/:id)
  // -------------------------------------------------------------
  console.log('\n--- 3. Kiểm thử phát hiện trùng lặp khi cập nhật tài khoản ---');

  // Cập nhật trùng email với user khác
  try {
    await usersService.update(createdUser.user.id, {
      email: 'sales@loha.vn', // thuộc về usr-sales-002
    });
    assert(false, 'Phải ném lỗi khi cập nhật email trùng với user khác');
  } catch (err: any) {
    assert(
      err instanceof BadRequestException &&
        err.message.includes('Tên đăng nhập hoặc email đã tồn tại trên hệ thống') &&
        err.message.includes('sales@loha.vn'),
      'Chặn cập nhật email trùng lặp: trả về 400 Bad Request rõ ràng',
    );
  }

  // Cập nhật trùng username với user khác
  try {
    await usersService.update(createdUser.user.id, {
      username: 'sales', // thuộc về usr-sales-002
    });
    assert(false, 'Phải ném lỗi khi cập nhật username trùng với user khác');
  } catch (err: any) {
    assert(
      err instanceof BadRequestException &&
        err.message.includes('Tên đăng nhập hoặc email đã tồn tại trên hệ thống') &&
        err.message.includes('sales'),
      'Chặn cập nhật username trùng lặp: trả về 400 Bad Request rõ ràng',
    );
  }

  // Cập nhật hợp lệ cho chính user này
  const updated = await usersService.update(createdUser.user.id, {
    fullName: 'Hoàng Kim Chi (Kinh Doanh Xuất Sắc)',
    phone: '0988776699',
    assignedWarehouse: 'Địa bàn Miền Tây',
  });
  assert(
    updated.fullName === 'Hoàng Kim Chi (Kinh Doanh Xuất Sắc)',
    'Cập nhật thành công các thông tin hợp lệ của người dùng',
  );
  assert(updated.phone === '0988776699', 'Số điện thoại được cập nhật chính xác');
  assert(updated.assignedWarehouse === 'Địa bàn Miền Tây', 'Địa bàn phụ trách được cập nhật chính xác');

  // -------------------------------------------------------------
  // Test 4: Phân trang mặc định 20 dòng & Tìm kiếm không phân biệt hoa thường
  // -------------------------------------------------------------
  console.log('\n--- 4. Kiểm thử Tìm kiếm & Phân trang mặc định 20 dòng / trang ---');

  const defaultPagination = await usersService.findAll({});
  assert(defaultPagination.limit === 20, 'Phân trang chuẩn: Mặc định limit = 20 dòng / trang');
  assert(defaultPagination.page === 1, 'Mặc định trang 1');
  assert(defaultPagination.total >= 9, `Tổng số lượng nhân sự ghi nhận: ${defaultPagination.total}`);

  // Tìm theo họ tên không phân biệt hoa thường
  const searchName = await usersService.findAll({ search: 'kIm cHi' });
  assert(
    searchName.data.length >= 1 && searchName.data[0].id === createdUser.user.id,
    'Tìm kiếm không phân biệt hoa thường theo fullName thành công',
  );

  // Tìm theo username
  const searchUsername = await usersService.findAll({ search: 'HOANG_CHI' });
  assert(
    searchUsername.data.length >= 1 && searchUsername.data[0].id === createdUser.user.id,
    'Tìm kiếm không phân biệt hoa thường theo username thành công',
  );

  // Tìm theo email
  const searchEmail = await usersService.findAll({ search: 'KIMCHI.HOANG' });
  assert(
    searchEmail.data.length >= 1 && searchEmail.data[0].id === createdUser.user.id,
    'Tìm kiếm không phân biệt hoa thường theo email thành công',
  );

  // Tìm theo số điện thoại
  const searchPhone = await usersService.findAll({ search: '0988776699' });
  assert(
    searchPhone.data.length >= 1 && searchPhone.data[0].id === createdUser.user.id,
    'Tìm kiếm theo số điện thoại thành công',
  );

  // Lọc theo Role & Status
  const filterRole = await usersService.findAll({ role: UserRole.SALES_REP, status: UserStatus.ACTIVE });
  assert(
    filterRole.data.every((u) => u.role === UserRole.SALES_REP && u.status === UserStatus.ACTIVE),
    'Lọc kết hợp theo Role và Status chính xác 100%',
  );

  console.log('\n=============================================================');
  console.log(`TỔNG KẾT KIỂM THỬ SN-13: ${passed} PASSED, ${failed} FAILED`);
  console.log('=============================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runSN13Tests().catch((err) => {
  console.error('Lỗi kiểm thử SN-13:', err);
  process.exit(1);
});
