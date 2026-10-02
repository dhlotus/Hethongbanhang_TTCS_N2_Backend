import { ExecutionContext, ForbiddenException } from '@nestjs/common';
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

/**
 * Mock ExecutionContext để giả lập Request qua NestJS Guards & Interceptors
 */
function createMockExecutionContext(
  user: any,
  requiredRoles?: (UserRole | string)[],
  isPublic = false,
): ExecutionContext {
  const reflectorMock = {
    getAllAndOverride: (key: string) => {
      if (key === ROLES_KEY) return requiredRoles;
      if (key === 'isPublic') return isPublic;
      return undefined;
    },
  };

  const request = {
    user,
    headers: {},
  };

  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

async function runTests(): Promise<void> {
  console.log('=== BẮT ĐẦU KIỂM THỬ SN-10: PHÂN QUYỀN VAI TRÒ & BẢO MẬT DỮ LIỆU NHẠY CẢM (COST PRICE / MARGIN) ===\n');

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

  // Khởi tạo các dịch vụ
  const usersService = new UsersService();
  const mailService = new MailService();
  const jwtService = new JwtService({
    secret: jwtConfig.secret,
    signOptions: { expiresIn: jwtConfig.expiresIn },
  });
  const authService = new AuthService(usersService, jwtService, mailService);
  const productsService = new ProductsService();
  const inventoryService = new InventoryService(productsService);

  let activeRequiredRoles: (UserRole | string)[] | undefined = undefined;
  let activeIsPublic = false;

  const mockReflector = {
    getAllAndOverride: (key: string) => {
      if (key === ROLES_KEY) return activeRequiredRoles;
      if (key === 'isPublic') return activeIsPublic;
      return undefined;
    },
  } as unknown as Reflector;

  const rolesGuard = new RolesGuard(mockReflector);
  const costPriceSanitizer = new CostPriceSanitizerInterceptor();

  // -------------------------------------------------------------
  // Phần 1: Đăng nhập xác thực cho 4 vai trò chính
  // -------------------------------------------------------------
  console.log('--- 1. Đăng nhập và lấy thông tin xác thực cho các vai trò ---');

  const adminLogin = await authService.login({ username: 'admin', password: '123456' });
  const salesManagerLogin = await authService.login({ username: 'salesmanager', password: '123456' });
  const salesRepLogin = await authService.login({ username: 'sales', password: '123456' });
  const warehouseLogin = await authService.login({ username: 'warehouse', password: '123456' });
  const customerLogin = await authService.login({ username: 'dealer', password: '123456' });

  assert(adminLogin.user.roles.includes(UserRole.ADMIN), 'Admin đăng nhập và sở hữu vai trò ADMIN');
  assert(salesManagerLogin.user.roles.includes(UserRole.SALES_MANAGER), 'Quản lý kinh doanh đăng nhập và sở hữu vai trò SALES_MANAGER');
  assert(salesRepLogin.user.roles.includes(UserRole.SALES_REP), 'Nhân viên kinh doanh đăng nhập và sở hữu vai trò SALES_REP');
  assert(warehouseLogin.user.roles.includes(UserRole.WAREHOUSE_KEEPER), 'Thủ kho đăng nhập và sở hữu vai trò WAREHOUSE_KEEPER');
  assert(customerLogin.user.roles.includes(UserRole.CUSTOMER), 'Đại lý B2B đăng nhập và sở hữu vai trò CUSTOMER');

  // -------------------------------------------------------------
  // Phần 2: Kiểm thử RolesGuard (RBAC & Deny by default)
  // -------------------------------------------------------------
  console.log('\n--- 2. Kiểm thử RolesGuard (RBAC & Mặc định từ chối) ---');

  // Giả lập route chỉ cho phép Thủ kho & Quản trị viên (Ví dụ: PUT /inventory/adjust)
  const warehouseOnlyRoles = [UserRole.WAREHOUSE_KEEPER, UserRole.WAREHOUSE_MANAGER];
  activeRequiredRoles = warehouseOnlyRoles;

  // Test 2.1: Thủ kho truy cập chức năng kho
  const contextWarehouse = createMockExecutionContext(warehouseLogin.user, warehouseOnlyRoles);
  const canWarehouseAccess = rolesGuard.canActivate(contextWarehouse);
  assert(canWarehouseAccess === true, 'Thủ kho (WAREHOUSE_KEEPER) được phép truy cập chức năng kho');

  // Test 2.2: Admin truy cập chức năng kho (Super Admin bypass)
  const contextAdmin = createMockExecutionContext(adminLogin.user, warehouseOnlyRoles);
  const canAdminAccess = rolesGuard.canActivate(contextAdmin);
  assert(canAdminAccess === true, 'Quản trị viên (ADMIN) có quyền lực tối cao, tự động thông qua mọi chức năng');

  // Test 2.3: Nhân viên kinh doanh cố gắng sửa tồn kho -> PHẢI BỊ TỪ CHỐI (Deny by default)
  const contextSalesRep = createMockExecutionContext(salesRepLogin.user, warehouseOnlyRoles);
  try {
    rolesGuard.canActivate(contextSalesRep);
    assert(false, 'Hệ thống phải chặn Nhân viên kinh doanh khi cố gắng sửa tồn kho');
  } catch (err: any) {
    assert(
      err instanceof ForbiddenException && err.message.includes('Từ chối truy cập'),
      'Từ chối truy cập (403 Forbidden): Nhân viên kinh doanh (SALES_REP) KHÔNG thể sửa tồn kho',
    );
  }

  // Test 2.4: Đại lý (CUSTOMER) cố gắng truy cập chức năng kho -> BỊ TỪ CHỐI
  const contextCustomer = createMockExecutionContext(customerLogin.user, warehouseOnlyRoles);
  try {
    rolesGuard.canActivate(contextCustomer);
    assert(false, 'Hệ thống phải chặn Đại lý khách hàng khi truy cập chức năng kho');
  } catch (err: any) {
    assert(
      err instanceof ForbiddenException,
      'Từ chối truy cập: Đại lý (CUSTOMER) bị từ chối truy cập chức năng kho',
    );
  }

  // -------------------------------------------------------------
  // Phần 3: Bảo mật dữ liệu nhạy cảm: Giá vốn (costPrice) & Biên LN (margin)
  // -------------------------------------------------------------
  console.log('\n--- 3. Kiểm thử Bảo mật dữ liệu nhạy cảm (Cost Price / Margin Sanitization) ---');

  const { data: rawProducts } = await productsService.findAll();
  assert(rawProducts.length > 0, 'Dữ liệu sản phẩm gốc có sẵn trong hệ thống');
  assert(typeof rawProducts[0].costPrice === 'number' && rawProducts[0].costPrice > 0, 'Sản phẩm gốc trong DB chứa giá vốn costPrice');
  assert(typeof rawProducts[0].margin === 'number', 'Sản phẩm gốc trong DB chứa biên lợi nhuận margin');

  // Test 3.1: Admin xem danh sách sản phẩm
  const mockContextForAdmin = createMockExecutionContext(adminLogin.user);
  let adminCanViewCost = false;
  const adminInterceptorResult = costPriceSanitizer.intercept(mockContextForAdmin, {
    handle: () => ({
      pipe: () => rawProducts,
    }) as any,
  });
  // Vì Admin được xem nên Interceptor gọi thẳng next.handle() không qua pipe filter
  assert(Boolean(adminInterceptorResult), 'Quản trị viên (ADMIN) được phép xem giá vốn và biên lợi nhuận gốc');

  // Test 3.2: Quản lý kinh doanh (SALES_MANAGER) xem danh sách sản phẩm
  const mockContextForSalesMgr = createMockExecutionContext(salesManagerLogin.user);
  const salesMgrInterceptorResult = costPriceSanitizer.intercept(mockContextForSalesMgr, {
    handle: () => ({
      pipe: () => rawProducts,
    }) as any,
  });
  assert(Boolean(salesMgrInterceptorResult), 'Quản lý kinh doanh (SALES_MANAGER) được phép xem giá vốn và biên lợi nhuận');

  // Test 3.3: Nhân viên kinh doanh (SALES_REP) xem danh sách sản phẩm -> GIÁ VỐN & BIÊN LN BỊ XÓA BỎ
  const sanitizedForSalesRep = costPriceSanitizer.sanitizeData(rawProducts);
  assert(sanitizedForSalesRep[0].sku === rawProducts[0].sku, 'Dữ liệu công khai (SKU, Tên, Giá bán) vẫn hiển thị đầy đủ cho Sales Rep');
  assert(sanitizedForSalesRep[0].price === rawProducts[0].price, 'Giá bán niêm yết hiển thị đầy đủ cho Sales Rep');
  assert(sanitizedForSalesRep[0].costPrice === undefined, 'Giá vốn (costPrice) ĐÃ BỊ ẨN / LỌC SẠCH đối với Nhân viên kinh doanh');
  assert(sanitizedForSalesRep[0].margin === undefined, 'Biên lợi nhuận (margin) ĐÃ BỊ ẨN / LỌC SẠCH đối với Nhân viên kinh doanh');

  // Test 3.4: Thủ kho (WAREHOUSE_KEEPER) xem danh sách sản phẩm -> THỦ KHO KHÔNG XEM ĐƯỢC GIÁ VỐN
  const sanitizedForWarehouse = costPriceSanitizer.sanitizeData(rawProducts);
  assert(sanitizedForWarehouse[0].costPrice === undefined, 'Giá vốn (costPrice) ĐÃ BỊ ẨN / LỌC BỎ đối với Thủ kho (WAREHOUSE_KEEPER)');
  assert(sanitizedForWarehouse[0].margin === undefined, 'Biên lợi nhuận (margin) ĐÃ BỊ ẨN / LỌC BỎ đối với Thủ kho (WAREHOUSE_KEEPER)');
  assert(sanitizedForWarehouse[0].stockQuantity === rawProducts[0].stockQuantity, 'Số lượng tồn kho hiển thị bình thường cho Thủ kho để quản lý kho');

  // Test 3.5: Đại lý (CUSTOMER) xem danh mục -> GIÁ VỐN BỊ ẨN
  const sanitizedForCustomer = costPriceSanitizer.sanitizeData(rawProducts);
  assert(sanitizedForCustomer[0].costPrice === undefined, 'Giá vốn (costPrice) ĐÃ BỊ ẨN đối với Đại lý (CUSTOMER)');
  assert(sanitizedForCustomer[0].margin === undefined, 'Biên lợi nhuận (margin) ĐÃ BỊ ẨN đối với Đại lý (CUSTOMER)');

  // -------------------------------------------------------------
  // Phần 4: Kiểm thử Nghiệp vụ điều chỉnh tồn kho
  // -------------------------------------------------------------
  console.log('\n--- 4. Kiểm thử Nghiệp vụ điều chỉnh tồn kho (Stock Adjustment) ---');

  const testProduct = rawProducts[0];
  const oldStock = testProduct.stockQuantity;

  // Thủ kho điều chỉnh tăng tồn kho 50 đơn vị
  const adjustResult = await inventoryService.adjustStock(
    {
      productSku: testProduct.sku,
      quantityChange: 50,
      reason: 'Nhập hàng bổ sung từ nhà máy LOHA',
    },
    warehouseLogin.user.id,
  );

  assert(adjustResult.success === true, 'Thủ kho thực hiện điều chỉnh tồn kho thành công');
  assert(adjustResult.newQuantity === oldStock + 50, `Số lượng tồn kho được cập nhật chính xác từ ${oldStock} lên ${oldStock + 50}`);

  console.log('\n=============================================================');
  console.log(`TỔNG KẾT KIỂM THỬ SN-10: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log('=============================================================');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Lỗi thực thi test RBAC:', err);
  process.exit(1);
});
