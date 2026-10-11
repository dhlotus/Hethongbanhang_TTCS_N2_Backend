import { CustomersService } from '../src/modules/customers/customers.service';
import { CustomersController } from '../src/modules/customers/customers.controller';
import { CustomerStatus } from '../src/modules/customers/entities/customer.entity';
import { UserRole } from '../src/common/enums/user-role.enum';
import { ICurrentUser } from '../src/modules/auth/interfaces/current-user.interface';

async function runTestSuite(): Promise<void> {
  console.log('========================================================================');
  console.log('  BẮT ĐẦU KIỂM THỬ TOÀN DIỆN SUBTASK SN-37 (EP-03 / S3-08 / SPRINT 3)');
  console.log('  TÌM KIẾM NHANH, BỘ LỌC ĐA TIÊU CHÍ & PHÂN QUYỀN TUYẾN BÁN HÀNG ĐẠI LÝ');
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, message: string): void {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  const service = new CustomersService();
  const controller = new CustomersController(service);

  const adminUser: ICurrentUser = {
    userId: 'usr-admin-01',
    email: 'admin@loha.vn',
    roles: [UserRole.ADMIN],
  };

  const salesManagerUser: ICurrentUser = {
    userId: 'usr-sm-01',
    email: 'sales.manager@loha.vn',
    roles: [UserRole.SALES_MANAGER],
  };

  const salesRep1: ICurrentUser = {
    userId: 'usr-sale-01',
    email: 'long.tran@loha.vn',
    roles: [UserRole.SALES_REP],
  };

  const salesRep2: ICurrentUser = {
    userId: 'usr-sale-02',
    email: 'hang.nguyen@loha.vn',
    roles: [UserRole.SALES_REP],
  };

  const realSalesUser: ICurrentUser = {
    userId: 'usr-sales-002',
    email: 'sales@loha.vn',
    username: 'sales',
    roles: [UserRole.SALES_REP],
  };

  // =====================================================================
  // PHẦN 1: TÌM KIẾM NHANH (FULL-TEXT / PARTIAL SEARCH) - TIÊU CHÍ AC2
  // =====================================================================
  console.log('--- 1. Kiểm thử Tìm kiếm Nhanh (Mã, Tên, Số điện thoại) ---');

  const resCodeExact = await service.filterCustomers({ search: 'dl-hcm-001' }, adminUser);
  assert(resCodeExact.total === 1 && resCodeExact.data[0].code === 'DL-HCM-001', 'Tìm kiếm chính xác mã đại lý không phân biệt hoa thường (dl-hcm-001)');

  const resCodePartial = await service.filterCustomers({ search: 'DL-HCM' }, adminUser);
  assert(resCodePartial.total >= 3 && resCodePartial.data.every((c) => c.code.includes('DL-HCM')), 'Tìm kiếm mã đại lý theo một phần (DL-HCM)');

  const resName = await service.filterCustomers({ search: 'Minh Khang' }, adminUser);
  assert(resName.total >= 1 && resName.data[0].name.includes('Minh Khang'), 'Tìm kiếm theo tên đại lý (Minh Khang)');

  const resNameNoAccent = await service.filterCustomers({ search: 'minh khang' }, adminUser);
  assert(resNameNoAccent.total >= 1 && resNameNoAccent.data[0].name.includes('Minh Khang'), 'Tìm kiếm đại lý KHÔNG DẤU thành công (minh khang -> Minh Khang)');

  const resNameLower = await service.filterCustomers({ search: 'bảo châu' }, adminUser);
  assert(resNameLower.total >= 1 && resNameLower.data[0].name.includes('Bảo Châu'), 'Tìm kiếm không phân biệt hoa thường theo tên đại lý (bảo châu)');

  const resBaoChauNoAccent = await service.filterCustomers({ search: 'bao chau' }, adminUser);
  assert(resBaoChauNoAccent.total >= 1 && resBaoChauNoAccent.data[0].name.includes('Bảo Châu'), 'Tìm kiếm đại lý KHÔNG DẤU thành công (bao chau -> Bảo Châu)');

  const resPhone = await service.filterCustomers({ search: '0901234567' }, adminUser);
  assert(resPhone.total === 1 && resPhone.data[0].phone === '0901234567', 'Tìm kiếm đại lý theo số điện thoại chính xác (0901234567)');

  const resPhonePartial = await service.filterCustomers({ search: '098765' }, adminUser);
  assert(resPhonePartial.total >= 1 && resPhonePartial.data.some((c) => c.phone.includes('098765')), 'Tìm kiếm đại lý theo đầu số điện thoại một phần (098765)');

  const resNotFound = await service.filterCustomers({ search: 'KHONG_TON_TAI_9999' }, adminUser);
  assert(resNotFound.total === 0 && resNotFound.data.length === 0, 'Tìm kiếm không khớp trả về kết quả rỗng (total = 0)');

  // =====================================================================
  // PHẦN 2: BỘ LỌC ĐA TIÊU CHÍ (REGION, GROUP, STATUS, SALESREPID) - AC1
  // =====================================================================
  console.log('\n--- 2. Kiểm thử Bộ Lọc Đa Tiêu Chí ---');

  const resMienBac = await service.filterCustomers({ region: 'Miền Bắc' }, adminUser);
  assert(resMienBac.total >= 2 && resMienBac.data.every((c) => c.region === 'Miền Bắc'), 'Lọc danh sách đại lý theo khu vực Miền Bắc');

  const resMienTrung = await service.filterCustomers({ region: 'Miền Trung' }, adminUser);
  assert(resMienTrung.total >= 1 && resMienTrung.data.every((c) => c.region === 'Miền Trung'), 'Lọc danh sách đại lý theo khu vực Miền Trung');

  const resMienNam = await service.filterCustomers({ region: 'Miền Nam' }, adminUser);
  assert(resMienNam.total >= 3 && resMienNam.data.every((c) => c.region === 'Miền Nam'), 'Lọc danh sách đại lý theo khu vực Miền Nam');

  const resLevel1 = await service.filterCustomers({ customerGroup: 'AGENT_LEVEL_1' }, adminUser);
  assert(resLevel1.total >= 2 && resLevel1.data.every((c) => c.customerGroup === 'AGENT_LEVEL_1'), 'Lọc theo nhóm đại lý Cấp 1 (AGENT_LEVEL_1)');

  const resRetail = await service.filterCustomers({ customerGroup: 'RETAIL' }, adminUser);
  assert(resRetail.total >= 1 && resRetail.data.every((c) => c.customerGroup === 'RETAIL'), 'Lọc theo nhóm Khách lẻ / Siêu thị (RETAIL)');

  const resActive = await service.filterCustomers({ status: CustomerStatus.ACTIVE }, adminUser);
  assert(resActive.total >= 5 && resActive.data.every((c) => c.status === CustomerStatus.ACTIVE), 'Lọc đại lý đang hoạt động (ACTIVE)');

  const resLocked = await service.filterCustomers({ status: CustomerStatus.LOCKED }, adminUser);
  assert(resLocked.total >= 1 && resLocked.data.every((c) => c.status === CustomerStatus.LOCKED), 'Lọc đại lý bị khóa nợ xấu (LOCKED)');

  const resInactive = await service.filterCustomers({ status: CustomerStatus.INACTIVE }, adminUser);
  assert(resInactive.total >= 1 && resInactive.data.every((c) => c.status === CustomerStatus.INACTIVE), 'Lọc đại lý ngừng kinh doanh (INACTIVE)');

  const resMulti = await service.filterCustomers(
    {
      region: 'Miền Nam',
      customerGroup: 'AGENT_LEVEL_1',
      status: CustomerStatus.ACTIVE,
    },
    adminUser,
  );
  assert(
    resMulti.total >= 1 &&
      resMulti.data.every(
        (c) =>
          c.region === 'Miền Nam' &&
          c.customerGroup === 'AGENT_LEVEL_1' &&
          c.status === CustomerStatus.ACTIVE,
      ),
    'Kết hợp đồng thời 3 bộ lọc: Miền Nam + AGENT_LEVEL_1 + ACTIVE',
  );

  // =====================================================================
  // PHẦN 3: PHÂN QUYỀN TUYẾN BÁN HÀNG THEO VAI TRÒ (RBAC SCOPE)
  // =====================================================================
  console.log('\n--- 3. Kiểm thử Phân Quyền Tuyến Bán Hàng (RBAC Scope) ---');

  const resRep1 = await service.filterCustomers({}, salesRep1);
  assert(
    resRep1.total >= 1 && resRep1.data.every((c) => c.salesRepId === salesRep1.userId),
    'Nhân viên SALES_REP 1 chỉ xem được các đại lý do mình phụ trách (usr-sale-01)',
  );

  const resRep2 = await service.filterCustomers({}, salesRep2);
  assert(
    resRep2.total >= 1 && resRep2.data.every((c) => c.salesRepId === salesRep2.userId),
    'Nhân viên SALES_REP 2 chỉ xem được các đại lý do mình phụ trách (usr-sale-02)',
  );

  const rep1Ids = new Set(resRep1.data.map((c) => c.id));
  const hasOverlap = resRep2.data.some((c) => rep1Ids.has(c.id));
  assert(!hasOverlap, 'Phân quyền chặt chẽ: Dữ liệu đại lý giữa 2 SALES_REP không bị lộ lẫn nhau');

  const resAdmin = await service.filterCustomers({}, adminUser);
  const resSM = await service.filterCustomers({}, salesManagerUser);
  assert(
    resAdmin.total === resSM.total && resAdmin.total >= 7,
    `ADMIN và SALES_MANAGER xem được toàn bộ đại lý công ty (thực tế: ${resAdmin.total})`,
  );

  const resFilterByRep = await service.filterCustomers(
    { salesRepId: 'usr-sale-01' },
    salesManagerUser,
  );
  assert(
    resFilterByRep.total >= 1 && resFilterByRep.data.every((c) => c.salesRepId === 'usr-sale-01'),
    'Quản lý kinh doanh lọc đại lý theo nhân viên cấp dưới cụ thể thành công',
  );

  const resRealRep = await service.filterCustomers({}, realSalesUser);
  assert(
    resRealRep.total >= 1 && resRealRep.data.length > 0,
    `Tài khoản đăng nhập thực tế của Sales Rep (usr-sales-002 / sales) xem được danh sách đại lý trong tuyến (thực tế: ${resRealRep.total})`,
  );

  // =====================================================================
  // PHẦN 4: PHÂN TRANG KẾT QUẢ (PAGINATION)
  // =====================================================================
  console.log('\n--- 4. Kiểm thử Phân Trang (Pagination) ---');

  const resPage1 = await service.filterCustomers({ page: 1, limit: 3 }, adminUser);
  assert(resPage1.data.length === 3, 'Trang 1 lấy đúng 3 phần tử khi limit = 3');
  assert(resPage1.page === 1, 'Thông số page = 1 chính xác');
  assert(resPage1.limit === 3, 'Thông số limit = 3 chính xác');
  assert(resPage1.totalPages >= 3, `Tổng số trang tính đúng (totalPages >= 3, thực tế: ${resPage1.totalPages})`);

  const resPage2 = await service.filterCustomers({ page: 2, limit: 3 }, adminUser);
  assert(resPage2.data.length === 3, 'Trang 2 lấy đúng 3 phần tử tiếp theo');
  assert(resPage2.page === 2, 'Thông số page = 2 chính xác');

  const p1Ids = resPage1.data.map((c) => c.id);
  const pageConflict = resPage2.data.some((c) => p1Ids.includes(c.id));
  assert(!pageConflict, 'Dữ liệu giữa Trang 1 và Trang 2 hoàn toàn tách biệt, không trùng lặp');

  // =====================================================================
  // PHẦN 5: CONTROLLER INTEGRATION TEST & DỮ LIỆU CHUẨN
  // =====================================================================
  console.log('\n--- 5. Kiểm thử Tích hợp Controller & Format Response Chuẩn ---');

  const controllerRes = await controller.getCustomers(
    { search: 'Hà Nội', limit: 10 },
    adminUser,
  );

  assert(
    typeof controllerRes.total === 'number' &&
      typeof controllerRes.page === 'number' &&
      typeof controllerRes.limit === 'number' &&
      typeof controllerRes.totalPages === 'number' &&
      Array.isArray(controllerRes.data),
    'Controller trả về đúng cấu trúc chuẩn PaginatedCustomersResult { data, total, page, limit, totalPages }',
  );

  const sample = controllerRes.data[0];
  assert(
    sample &&
      typeof sample.id === 'string' &&
      typeof sample.code === 'string' &&
      typeof sample.name === 'string' &&
      typeof sample.phone === 'string' &&
      typeof sample.creditLimit === 'number' &&
      typeof sample.currentDebt === 'number' &&
      typeof sample.status === 'string' &&
      Boolean(sample.salesRep && sample.salesRep.id && sample.salesRep.name),
    'Từng phần tử đại lý có đầy đủ thông tin chuẩn hóa: id, code, name, phone, creditLimit, currentDebt, status, salesRep {id, name}',
  );

  console.log('\n========================================================================');
  console.log(`  TỔNG KẾT KIỂM THỬ SUBTASK SN-37: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Lỗi thực thi kiểm thử:', err);
  process.exit(1);
});
