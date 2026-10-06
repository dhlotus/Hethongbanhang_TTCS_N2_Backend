import { ExecutionContext, ForbiddenException, BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';
import { UserRole } from '../src/common/enums/user-role.enum';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { CostPriceSanitizerInterceptor } from '../src/common/interceptors/cost-price-sanitizer.interceptor';
import { jwtConfig } from '../src/config/jwt.config';
import { AuthService } from '../src/modules/auth/auth.service';
import { MailService } from '../src/modules/mail/mail.service';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { ProductsService } from '../src/modules/products/products.service';
import { UsersService } from '../src/modules/users/users.service';
import { SuppliersService } from '../src/modules/suppliers/suppliers.service';

/**
 * Mock ExecutionContext để giả lập Request qua NestJS Guards & Interceptors
 */
function createMockExecutionContext(
  user: any,
  requiredRoles?: (UserRole | string)[],
  isPublic = false,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user, headers: {} }),
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

async function runWarehouseKeeperVerification(): Promise<void> {
  console.log('=================================================================================');
  console.log('  BỘ KIỂM THỬ TOÀN DIỆN & DEMO CHỨNG MINH VAI TRÒ NHÂN VIÊN KHO (WAREHOUSE_KEEPER)');
  console.log('=================================================================================\n');

  let passedCount = 0;
  let failedCount = 0;

  function assert(condition: boolean, testName: string, detail?: string): void {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      if (detail) console.log(`     └─ Chi tiết: ${detail}`);
      passedCount++;
    } else {
      console.error(`  ❌ FAIL: ${testName}`);
      if (detail) console.error(`     └─ Chi tiết: ${detail}`);
      failedCount++;
    }
  }

  // Khởi tạo các Service cốt lõi
  const usersService = new UsersService();
  const mailService = new MailService();
  const jwtService = new JwtService({
    secret: jwtConfig.secret,
    signOptions: { expiresIn: jwtConfig.expiresIn },
  });
  const authService = new AuthService(usersService, jwtService, mailService);
  const productsService = new ProductsService();
  const inventoryService = new InventoryService(productsService);
  inventoryService.onModuleInit();
  const suppliersService = new SuppliersService();
  const costPriceSanitizer = new CostPriceSanitizerInterceptor();

  let activeRequiredRoles: (UserRole | string)[] | undefined = undefined;
  const mockReflector = {
    getAllAndOverride: (key: string) => {
      if (key === ROLES_KEY) return activeRequiredRoles;
      if (key === 'isPublic') return false;
      return undefined;
    },
  } as unknown as Reflector;
  const rolesGuard = new RolesGuard(mockReflector);

  // =========================================================================
  // GIAI ĐOẠN 1: XÁC THỰC VÀ THÔNG TIN TÀI KHOẢN THỦ KHO
  // =========================================================================
  console.log('\n--- 1. XÁC THỰC & RÀNG BUỘC TÀI KHOẢN NHÂN VIÊN KHO ---');

  // Test 1.1: Đăng nhập tài khoản nhân viên kho
  const warehouseLogin = await authService.login({ username: 'warehouse', password: '123456' });
  const whUser = warehouseLogin.user;
  assert(
    whUser && whUser.roles.includes(UserRole.WAREHOUSE_KEEPER),
    'Đăng nhập thành công với tài khoản Thủ kho (warehouse/123456)',
    `User ID: ${whUser.id}, Tên: ${whUser.fullName}, Roles: [${whUser.roles.join(', ')}]`,
  );

  // Test 1.2: Kiểm tra phân công kho trực thuộc (assignedWarehouse)
  assert(
    Boolean(whUser.assignedWarehouse && whUser.assignedWarehouse.includes('Kho')),
    'Nhân viên kho có thông tin kho phụ trách hợp lệ',
    `Kho phụ trách: "${whUser.assignedWarehouse}"`,
  );

  // Test 1.3: Ràng buộc nghiệp vụ: Tạo nhân viên kho bắt buộc phải có kho phụ trách
  let rejectedNoWh = false;
  try {
    await usersService.create({
      fullName: 'Thủ kho thử nghiệm thiếu kho',
      username: `wh_test_${Date.now()}`,
      email: `wh_test_${Date.now()}@loha.vn`,
      password: 'Password@123',
      role: UserRole.WAREHOUSE_KEEPER,
      assignedWarehouse: '', // Cố tình bỏ trống kho
    });
  } catch (err: any) {
    if (err instanceof BadRequestException && (err.message.includes('kho cụ thể') || err.message.includes('vai trò kho'))) {
      rejectedNoWh = true;
    }
  }
  assert(
    rejectedNoWh,
    'Hệ thống bắt buộc chặn (400 Bad Request) nếu tạo Thủ kho mà không gán kho phụ trách',
    'Bảo đảm tính toàn vẹn phân cấp trách nhiệm kho hàng',
  );

  // =========================================================================
  // GIAI ĐOẠN 2: CHỨC NĂNG TRA CỨU SỔ TỒN KHO & ĐƠN VỊ TÍNH (GET /inventory/stock)
  // =========================================================================
  console.log('\n--- 2. CHỨC NĂNG TRA CỨU TỒN KHO & QUY ĐỔI ĐƠN VỊ TÍNH ---');

  const stockList = await inventoryService.getStockOverview();
  assert(
    Array.isArray(stockList) && stockList.length > 0,
    'Thủ kho tra cứu thành công danh sách sổ tồn kho tổng hợp',
    `Số lượng SKU theo dõi: ${stockList.length} sản phẩm`,
  );

  const milkStock = stockList.find((s) => s.sku.includes('LH-MILK'));
  assert(
    milkStock !== undefined &&
      milkStock.baseUnit === 'Lon' &&
      milkStock.units.length >= 3 &&
      milkStock.warehouse !== undefined,
    'SKU có đầy đủ thông tin đơn vị cơ sở, hệ số quy đổi và kho lưu trữ',
    `SKU: ${milkStock?.sku} | Tồn: ${milkStock?.stockQuantity} ${milkStock?.baseUnit} | Quy đổi: ${milkStock?.units.map((u) => `1 ${u.unitName} = ${u.conversionRate}`).join(', ')}`,
  );

  // =========================================================================
  // GIAI ĐOẠN 3: NGHIỆP VỤ NHẬP KHO THEO ĐƠN VỊ LỚN (THÙNG -> LON) & GHI SỔ KHO
  // =========================================================================
  console.log('\n--- 3. NGHIỆP VỤ NHẬP KHO HÀNG HÓA (IMPORT) QUY ĐỔI ĐƠN VỊ TỰ ĐỘNG ---');

  const milkBefore = await productsService.findById('LH-MILK-900G');
  const initialStock = milkBefore.stockQuantity;

  // Thủ kho thực hiện nhập 10 Thùng (hệ số 24 Lon/thùng)
  const importResult = await inventoryService.adjustStock(
    {
      productSku: 'LH-MILK-900G',
      quantityChange: 10,
      unit: 'Thùng',
      reason: 'Nhập hàng lô mới từ Nhà máy Dược Loha',
      referenceCode: 'PNK-2026-DEMO-01',
      warehouseLocation: whUser.assignedWarehouse,
    },
    whUser.id,
  );

  assert(
    importResult.success &&
      importResult.inputQuantity === 10 &&
      importResult.inputUnit === 'Thùng' &&
      importResult.conversionRate === 24 &&
      importResult.baseQuantityChange === 240 &&
      importResult.newQuantity === initialStock + 240,
    'Nhập kho 10 Thùng tự động quy đổi thành +240 Lon cơ sở và cập nhật tồn kho',
    `Tồn ban đầu: ${initialStock} Lon -> Tồn mới: ${importResult.newQuantity} Lon (Tăng đúng 240 Lon)`,
  );

  // Kiểm tra sổ thẻ kho (Inventory Ledger)
  const txListAfterImport = await inventoryService.getTransactions('LH-MILK-900G');
  const importTx = txListAfterImport.find((t) => t.referenceCode === 'PNK-2026-DEMO-01');
  assert(
    importTx !== undefined &&
      importTx.transactionType === 'IMPORT' &&
      importTx.conversionRate === 24 &&
      importTx.baseQuantityChange === 240 &&
      importTx.performedBy === whUser.id,
    'Sổ kho ghi nhận chính xác giao dịch nhập kho với mã chứng từ PNK và thông tin thủ kho',
    `Mã chứng từ: ${importTx?.referenceCode} | Thao tác bởi: ${importTx?.performedBy}`,
  );

  // =========================================================================
  // GIAI ĐOẠN 4: NGHIỆP VỤ SOẠN HÀNG & XUẤT KHO (EXPORT) THEO ĐƠN VỊ LỐC
  // =========================================================================
  console.log('\n--- 4. NGHIỆP VỤ SOẠN HÀNG & XUẤT KHO (EXPORT) ---');

  const stockBeforeExport = importResult.newQuantity;
  // Thủ kho xuất 5 Lốc (hệ số 6 Lon/lốc -> giảm 30 Lon)
  const exportResult = await inventoryService.adjustStock(
    {
      productSku: 'LH-MILK-900G',
      quantityChange: -5,
      unit: 'Lốc',
      reason: 'Xuất hàng giao cho Đại lý Phân phối Miền Nam',
      referenceCode: 'PXK-2026-DEMO-02',
      warehouseLocation: whUser.assignedWarehouse,
    },
    whUser.id,
  );

  assert(
    exportResult.success &&
      exportResult.inputQuantity === -5 &&
      exportResult.inputUnit === 'Lốc' &&
      exportResult.conversionRate === 6 &&
      exportResult.baseQuantityChange === -30 &&
      exportResult.newQuantity === stockBeforeExport - 30,
    'Xuất kho 5 Lốc tự động quy đổi giảm chính xác -30 Lon cơ sở',
    `Tồn trước: ${stockBeforeExport} Lon -> Tồn sau xuất: ${exportResult.newQuantity} Lon`,
  );

  // =========================================================================
  // GIAI ĐOẠN 5: CHỐNG TỒN KHO ÂM TUYỆT ĐỐI (NEGATIVE STOCK PREVENTION)
  // =========================================================================
  console.log('\n--- 5. KIỂM THỬ CHỐNG TỒN KHO ÂM TUYỆT ĐỐI ---');

  let rejectedOverExport = false;
  let overExportErrorMessage = '';
  try {
    // Cố tình xuất 500 Thùng (= 12,000 Lon), trong khi tồn kho chỉ còn khoảng vài trăm Lon
    await inventoryService.adjustStock(
      {
        productSku: 'LH-MILK-900G',
        quantityChange: -500,
        unit: 'Thùng',
        reason: 'Cố tình xuất vượt quá tồn kho',
      },
      whUser.id,
    );
  } catch (err: any) {
    if (err instanceof BadRequestException && err.message.includes('vượt quá tồn kho')) {
      rejectedOverExport = true;
      overExportErrorMessage = err.message;
    }
  }

  assert(
    rejectedOverExport,
    'Hệ thống chặn đứng ngay lập tức khi xuất vượt tồn kho khả dụng (Chống tồn kho âm)',
    `Thông báo lỗi: "${overExportErrorMessage}"`,
  );

  // =========================================================================
  // GIAI ĐOẠN 6: SNAPSHOT BẤT BIẾN CỦA SỔ KHO KHI THAY ĐỔI HỆ SỐ QUY ĐỔI
  // =========================================================================
  console.log('\n--- 6. KIỂM THỬ TÍNH BẤT BIẾN CỦA SỔ THẺ KHO (SNAPSHOT IMMUTABILITY) ---');

  // Đổi quy cách đóng gói Thùng từ 24 Lon -> 30 Lon
  await productsService.update('LH-MILK-900G', {
    packagingSpec: '30 lon/thùng quy cách 2027',
    units: [
      { unitName: 'Lon', conversionRate: 1, isBaseUnit: true },
      { unitName: 'Lốc', conversionRate: 6 },
      { unitName: 'Thùng', conversionRate: 30 },
    ],
  });

  // Kiểm tra lại giao dịch cũ PNK-2026-DEMO-01 đã ghi trước đó
  const allTxs = await inventoryService.getTransactions('LH-MILK-900G');
  const pastTx = allTxs.find((t) => t.referenceCode === 'PNK-2026-DEMO-01');

  assert(
    pastTx !== undefined &&
      pastTx.conversionRate === 24 &&
      pastTx.baseQuantityChange === 240,
    'Giao dịch lịch sử không bị thay đổi dù hệ số quy đổi tương lai của SKU đã đổi sang 30',
    `Snapshot cũ: 1 Thùng = ${pastTx?.conversionRate} Lon, Số lượng quy đổi cũ: ${pastTx?.baseQuantityChange} Lon (BẢO TOÀN SỔ SÁCH)`,
  );

  // =========================================================================
  // GIAI ĐOẠN 7: BẢO MẬT DỮ LIỆU KINH DOANH (ẨN GIÁ VỐN & BIÊN LỢI NHUẬN)
  // =========================================================================
  console.log('\n--- 7. BẢO MẬT DỮ LIỆU NHẠY CẢM ĐỐI VỚI VAI TRÒ THỦ KHO ---');

  const rawProducts = await productsService.findAll();
  const sanitizedForWh = costPriceSanitizer.sanitizeData(rawProducts) as Record<string, unknown>[];

  assert(
    sanitizedForWh[0].costPrice === undefined && sanitizedForWh[0].margin === undefined,
    'Thủ kho (WAREHOUSE_KEEPER) bị ẩn hoàn toàn Giá vốn (costPrice) và Biên lợi nhuận (margin)',
    'Đảm bảo bí mật kinh doanh, nhân viên kho chỉ quản lý số lượng và quy cách hàng hóa',
  );

  assert(
    sanitizedForWh[0].sku !== undefined &&
      sanitizedForWh[0].name !== undefined &&
      sanitizedForWh[0].stockQuantity !== undefined,
    'Thủ kho vẫn xem đầy đủ các trường thông tin cần thiết: SKU, Tên, Số lượng tồn, Đơn vị tính',
    `Ví dụ: SKU ${sanitizedForWh[0].sku} - ${sanitizedForWh[0].name} | Tồn: ${sanitizedForWh[0].stockQuantity}`,
  );

  // =========================================================================
  // GIAI ĐOẠN 8: KIỂM SOÁT PHÂN QUYỀN RBAC (QUYỀN ĐƯỢC PHÉP VÀ QUYỀN BỊ CHẶN)
  // =========================================================================
  console.log('\n--- 8. KIỂM THỬ PHÂN QUYỀN RBAC (ROLES GUARD) ---');

  // Test 8.1: Thủ kho truy cập chức năng kho (PUT /inventory/adjust) -> Được phép
  activeRequiredRoles = [UserRole.WAREHOUSE_KEEPER, UserRole.WAREHOUSE_MANAGER];
  const whContext = createMockExecutionContext(whUser, activeRequiredRoles);
  const whCanAccessInventory = rolesGuard.canActivate(whContext);
  assert(
    whCanAccessInventory === true,
    'Thủ kho được phép thực hiện chức năng Quản lý Kho (/inventory/adjust)',
    'RBAC xác nhận quyền WAREHOUSE_KEEPER hợp lệ',
  );

  // Test 8.2: Nhân viên kinh doanh (SALES_REP) cố gắng chỉnh tồn kho -> BỊ CHẶN 403
  const salesLogin = await authService.login({ username: 'sales', password: '123456' });
  const salesContext = createMockExecutionContext(salesLogin.user, activeRequiredRoles);
  let salesBlocked = false;
  try {
    rolesGuard.canActivate(salesContext);
  } catch (err: any) {
    if (err instanceof ForbiddenException) salesBlocked = true;
  }
  assert(
    salesBlocked,
    'Nhân viên kinh doanh (SALES_REP) bị từ chối truy cập (403 Forbidden) khi can thiệp vào kho',
    'Ngăn chặn nhân viên bán hàng tự ý chỉnh sửa số liệu kho',
  );

  // Test 8.3: Thủ kho cố gắng truy cập chức năng Quản lý Người dùng (Chỉ ADMIN) -> BỊ CHẶN 403
  const adminOnlyRoles = [UserRole.ADMIN];
  activeRequiredRoles = adminOnlyRoles;
  const whAccessAdminContext = createMockExecutionContext(whUser, adminOnlyRoles);
  let whBlockedFromAdmin = false;
  try {
    rolesGuard.canActivate(whAccessAdminContext);
  } catch (err: any) {
    if (err instanceof ForbiddenException) whBlockedFromAdmin = true;
  }
  assert(
    whBlockedFromAdmin,
    'Thủ kho bị chặn (403 Forbidden) khi cố tình truy cập chức năng Quản lý Người dùng (ADMIN)',
    'Đúng nguyên tắc Least Privilege (Đặc quyền tối thiểu)',
  );

  // =========================================================================
  // GIAI ĐOẠN 9: TRA CỨU NHÀ CUNG CẤP HÀNG HÓA (SN-25)
  // =========================================================================
  console.log('\n--- 9. TRA CỨU NHÀ CUNG CẤP DÀNH CHO THỦ KHO (SN-25) ---');

  const paginatedSuppliers = await suppliersService.findAllPaginated({});
  const suppliers = paginatedSuppliers.data;
  assert(
    Array.isArray(suppliers) && suppliers.length > 0,
    'Thủ kho tra cứu thành công danh sách đối tác nhà cung cấp để nhận hàng',
    `Số lượng nhà cung cấp: ${suppliers.length} đối tác (VD: ${suppliers[0]?.name})`,
  );

  // =========================================================================
  // TỔNG KẾT
  // =========================================================================
  console.log('\n=================================================================================');
  console.log(`  KẾT QUẢ KIỂM THỬ: ${passedCount} THÀNH CÔNG, ${failedCount} THẤT BẠI (TỔNG: ${passedCount + failedCount} TESTS)`);
  console.log('=================================================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runWarehouseKeeperVerification().catch((err) => {
  console.error('Lỗi khi chạy kiểm thử:', err);
  process.exit(1);
});
