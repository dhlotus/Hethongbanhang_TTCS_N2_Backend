import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';
import { ProductStatus } from '../src/common/enums/product-status.enum';
import { UserRole } from '../src/common/enums/user-role.enum';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { CostPriceSanitizerInterceptor } from '../src/common/interceptors/cost-price-sanitizer.interceptor';
import { PaginatedProductsResponse } from '../src/modules/products/interfaces/paginated-products.interface';
import { ProductsController } from '../src/modules/products/products.controller';
import { ProductsService } from '../src/modules/products/products.service';

/**
 * Mock ExecutionContext để giả lập request qua RolesGuard và CostPriceSanitizerInterceptor
 */
function createMockContext(
  user: { id?: string; roles?: string[]; role?: string },
  requiredRoles?: (UserRole | string)[],
): ExecutionContext {
  const reflectorMock = {
    getAllAndOverride: (key: string) => {
      if (key === ROLES_KEY) return requiredRoles;
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

async function runTestSuite(): Promise<void> {
  console.log('========================================================================');
  console.log('  BẮT ĐẦU KIỂM THỬ TOÀN DIỆN SUBTASK SN-138 (USER STORY SN-20 / SPRINT 2)');
  console.log('  API QUẢN LÝ SKU, PHÂN QUYỀN BẢO MẬT GIÁ VỐN & RÀNG BUỘC TOÀN VẸN DỮ LIỆU');
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

  const productsService = new ProductsService();
  const productsController = new ProductsController(productsService);
  const costPriceSanitizer = new CostPriceSanitizerInterceptor();

  let currentRequiredRoles: (UserRole | string)[] | undefined = undefined;
  const mockReflector = {
    getAllAndOverride: (key: string) => {
      if (key === ROLES_KEY) return currentRequiredRoles;
      return undefined;
    },
  } as unknown as Reflector;
  const rolesGuard = new RolesGuard(mockReflector);

  // Người dùng giả lập theo vai trò
  const adminUser = { id: 'user-admin', roles: [UserRole.ADMIN] };
  const salesManagerUser = { id: 'user-sm', roles: [UserRole.SALES_MANAGER] };
  const salesRepUser = { id: 'user-sales', roles: [UserRole.SALES_REP] };
  const warehouseUser = { id: 'user-wh', roles: [UserRole.WAREHOUSE_KEEPER] };
  const accountantUser = { id: 'user-acc', roles: [UserRole.ACCOUNTANT] };
  const customerUser = { id: 'user-cust', roles: [UserRole.CUSTOMER] };

  // =====================================================================
  // PHẦN 1: KIỂM THỬ KHỞI TẠO VÀ ENTITY SCHEMA
  // =====================================================================
  console.log('--- 1. Kiểm thử Schema và Dữ liệu Khởi tạo (11 Sản phẩm FMCG) ---');

  const initialProducts = await productsService.findAll();
  assert(initialProducts.length === 11, `Hệ thống đã khởi tạo đủ 11 sản phẩm mẫu chuẩn hóa (thực tế: ${initialProducts.length})`);

  const p1 = initialProducts[0];
  assert(p1.id === 'prod-001', 'Sản phẩm 1 có ID prod-001');
  assert(p1.sku === 'LH-MILK-900G', 'Sản phẩm 1 có SKU LH-MILK-900G');
  assert(p1.parentCategory === 'Sữa & Chế phẩm sữa', 'Sản phẩm 1 có parentCategory cấp 1');
  assert(p1.subCategory === 'Sữa bột công thức', 'Sản phẩm 1 có subCategory cấp 2');
  assert(p1.category === 'Sữa & Chế phẩm sữa / Sữa bột công thức', 'Sản phẩm 1 có category chuẩn format: parent / sub');
  assert(p1.baseUnit === 'Lon', 'Sản phẩm 1 có baseUnit là Lon');
  assert(p1.packagingSpec === '24 lon/thùng', 'Sản phẩm 1 có quy cách packagingSpec');
  assert(p1.price === 520000, 'Sản phẩm 1 có giá bán 520,000');
  assert(p1.costPrice === 380000, 'Sản phẩm 1 có giá vốn 380,000');
  assert(p1.margin === 26.92, 'Sản phẩm 1 có biên lợi nhuận margin = 26.92%');
  assert(p1.status === ProductStatus.ACTIVE, 'Sản phẩm 1 có trạng thái ACTIVE');
  assert(p1.hasTransactions === true, 'Sản phẩm 1 đã phát sinh giao dịch (hasTransactions: true)');

  const jsonP1 = p1.toJSON();
  assert(jsonP1.parent_category === 'Sữa & Chế phẩm sữa', 'toJSON cung cấp alias snake_case parent_category');
  assert(jsonP1.cost_price === 380000, 'toJSON cung cấp alias snake_case cost_price');
  assert(jsonP1.stock_quantity === 340, 'toJSON cung cấp alias snake_case stock_quantity');

  // =====================================================================
  // PHẦN 2: KIỂM THỬ GET /api/products (LỌC, TÌM KIẾM & PHÂN TRANG)
  // =====================================================================
  console.log('\n--- 2. Kiểm thử GET /api/products (Phân trang, Tìm kiếm & Lọc) ---');

  // Test 2.1: Phân trang mặc định (page 1, limit 20)
  const defaultPage = await productsController.findAll({});
  assert(defaultPage.total === 11, 'Tổng số sản phẩm là 11');
  assert(defaultPage.data.length === 11, 'Số lượng phần tử trang 1 là 11');
  assert(defaultPage.totalPages === 1, 'Tổng số trang là 1');
  assert(defaultPage.page === 1 && defaultPage.limit === 20, 'Thông số page=1, limit=20 chính xác');

  // Test 2.2: Phân trang tùy chỉnh (page 2, limit 4)
  const customPage = await productsController.findAll({ page: 2, limit: 4 });
  assert(customPage.total === 11, 'Tổng số sản phẩm vẫn là 11');
  assert(customPage.data.length === 4, 'Trang 2 lấy chính xác 4 sản phẩm');
  assert(customPage.totalPages === 3, '11 sản phẩm với limit=4 cho 3 trang');
  assert(customPage.page === 2, 'Trang hiện tại là trang 2');

  // Test 2.3: Tìm kiếm theo SKU
  const searchSku = await productsController.findAll({ search: 'LH-MILK' });
  assert(searchSku.total === 2, 'Tìm SKU "LH-MILK" trả về đúng 2 sản phẩm sữa bột và thanh trùng');

  // Test 2.4: Tìm kiếm theo Tên sản phẩm
  const searchName = await productsController.findAll({ search: 'Yến Sào' });
  assert(searchName.total === 2, 'Tìm tên "Yến Sào" trả về đúng 2 sản phẩm');

  // Test 2.5: Tìm kiếm không phân biệt chữ hoa chữ thường
  const searchCase = await productsController.findAll({ search: 'lh-nest' });
  assert(searchCase.total === 2 && searchCase.data.some((p) => p.sku === 'LH-NEST-70ML'), 'Tìm kiếm không phân biệt hoa thường "lh-nest" trả về đúng sản phẩm yến');

  // Test 2.6: Lọc theo parentCategory
  const filterParent = await productsController.findAll({ parentCategory: 'Sữa & Chế phẩm sữa' });
  assert(filterParent.total === 3, 'Lọc nhóm chính "Sữa & Chế phẩm sữa" trả về 3 sản phẩm');

  // Test 2.7: Lọc theo subCategory
  const filterSub = await productsController.findAll({ subCategory: 'Sữa hạt organic' });
  assert(filterSub.total === 1 && filterSub.data[0].sku === 'LH-NUT-180ML', 'Lọc nhóm phụ "Sữa hạt organic" trả về đúng LH-NUT-180ML');

  // Test 2.8: Lọc theo trạng thái INACTIVE
  const filterInactive = await productsController.findAll({ status: ProductStatus.INACTIVE });
  assert(filterInactive.total === 1 && filterInactive.data[0].sku === 'LH-OLD-COFFEE-CAN', 'Lọc INACTIVE trả về đúng sản phẩm cũ ngừng kinh doanh');

  // =====================================================================
  // PHẦN 3: KIỂM THỬ BẢO MẬT GIÁ VỐN & BIÊN LỢI NHUẬN THEO VAI TRÒ
  // =====================================================================
  console.log('\n--- 3. Kiểm thử Bảo mật Giá Vốn (costPrice) & Biên Lợi Nhuận (margin) ---');

  const samplePaginated = await productsController.findAll({ page: 1, limit: 5 });

  // Test 3.1: ADMIN xem danh sách -> Thấy đầy đủ giá vốn và margin
  const adminContext = createMockContext(adminUser);
  let adminSawCost: boolean = false;
  costPriceSanitizer.intercept(adminContext, {
    handle: () => {
      adminSawCost = true;
      return { pipe: () => samplePaginated } as unknown as Observable<unknown>;
    },
  });
  assert(adminSawCost, 'ADMIN được phép xem trực tiếp giá vốn và biên lợi nhuận (không bị lọc)');

  // Test 3.2: SALES_MANAGER xem danh sách -> Thấy đầy đủ giá vốn và margin
  const smContext = createMockContext(salesManagerUser);
  let smSawCost: boolean = false;
  costPriceSanitizer.intercept(smContext, {
    handle: () => {
      smSawCost = true;
      return { pipe: () => samplePaginated } as unknown as Observable<unknown>;
    },
  });
  assert(smSawCost, 'SALES_MANAGER được phép xem trực tiếp giá vốn và biên lợi nhuận (không bị lọc)');

  // Test 3.3: SALES_REP xem danh sách -> Bị lọc sạch costPrice và margin
  const sanitizedForSales = costPriceSanitizer.sanitizeData(samplePaginated) as PaginatedProductsResponse;
  const salesProd = sanitizedForSales.data[0];
  assert(salesProd.price === 520000, 'SALES_REP vẫn xem được giá bán niêm yết 520,000');
  assert(salesProd.costPrice === undefined, 'costPrice ĐÃ BỊ LOẠI BỎ hoàn toàn đối với SALES_REP');
  assert((salesProd as unknown as Record<string, unknown>).cost_price === undefined, 'cost_price snake_case ĐÃ BỊ LOẠI BỎ hoàn toàn đối với SALES_REP');
  assert(salesProd.margin === undefined, 'margin ĐÃ BỊ LOẠI BỎ hoàn toàn đối với SALES_REP');

  // Test 3.4: WAREHOUSE_KEEPER xem danh sách -> Bị lọc sạch costPrice và margin
  const sanitizedForWH = costPriceSanitizer.sanitizeData(samplePaginated) as PaginatedProductsResponse;
  const whProd = sanitizedForWH.data[0];
  assert(whProd.stockQuantity === 340, 'Thủ kho vẫn xem được số lượng tồn kho (340)');
  assert(whProd.costPrice === undefined, 'costPrice ĐÃ BỊ LOẠI BỎ đối với Thủ kho');
  assert(whProd.margin === undefined, 'margin ĐÃ BỊ LOẠI BỎ đối với Thủ kho');

  // Test 3.5: CUSTOMER (Đại lý) xem danh mục -> Bị lọc sạch costPrice và margin
  const sanitizedForCust = costPriceSanitizer.sanitizeData(samplePaginated) as PaginatedProductsResponse;
  const custProd = sanitizedForCust.data[0];
  assert(custProd.costPrice === undefined, 'costPrice ĐÃ BỊ LOẠI BỎ đối với Đại lý CUSTOMER');
  assert(custProd.margin === undefined, 'margin ĐÃ BỊ LOẠI BỎ đối với Đại lý CUSTOMER');

  // Test 3.6: ACCOUNTANT xem danh mục -> Bị lọc sạch costPrice và margin
  const sanitizedForAcc = costPriceSanitizer.sanitizeData(samplePaginated) as PaginatedProductsResponse;
  const accProd = sanitizedForAcc.data[0];
  assert(accProd.costPrice === undefined, 'costPrice ĐÃ BỊ LOẠI BỎ đối với Kế toán');
  assert(accProd.margin === undefined, 'margin ĐÃ BỊ LOẠI BỎ đối với Kế toán');

  // =====================================================================
  // PHẦN 4: KIỂM THỬ POST /api/products (THÊM MỚI SKU & RÀNG BUỘC)
  // =====================================================================
  console.log('\n--- 4. Kiểm thử POST /api/products (Tạo mới SKU & Ràng buộc) ---');

  const adminRolesPost = [UserRole.ADMIN, UserRole.SALES_MANAGER];
  currentRequiredRoles = adminRolesPost;

  // Test 4.1: Kiểm tra RolesGuard chặn SALES_REP tạo SKU
  const postContextSales = createMockContext(salesRepUser, adminRolesPost);
  try {
    rolesGuard.canActivate(postContextSales);
    assert(false, 'Hệ thống phải chặn SALES_REP khi tạo sản phẩm');
  } catch (err: unknown) {
    assert(err instanceof ForbiddenException, 'RolesGuard chặn thành công SALES_REP tạo SKU (403 Forbidden)');
  }

  // Test 4.2: ADMIN tạo thành công sản phẩm mới hợp lệ
  const newSkuDto = {
    sku: '  LH-PROMO-330ML  ', // Chứa khoảng trắng đầu đuôi cần trim và uppercase
    name: 'Nước Nha Đam Yến Sào Thanh Mát 330ml',
    parentCategory: 'Nước giải khát & Trà',
    subCategory: 'Trà thảo mộc thanh nhiệt',
    category: 'Nước giải khát & Trà / Trà thảo mộc thanh nhiệt',
    baseUnit: 'Lon',
    packagingSpec: '24 lon/thùng',
    price: 16000,
    costPrice: 9600,
    stockQuantity: 500,
    status: ProductStatus.ACTIVE,
    description: 'Phiên bản khuyến mãi chào hè 2026',
  };

  const createdProduct = await productsController.create(newSkuDto);
  assert(createdProduct.sku === 'LH-PROMO-330ML', 'SKU được tự động trim và uppercase thành LH-PROMO-330ML');
  assert(createdProduct.name === newSkuDto.name, 'Tên sản phẩm được lưu chính xác');
  assert(createdProduct.margin === 40, 'Biên lợi nhuận được tính chính xác: ((16000 - 9600) / 16000) * 100 = 40%');
  assert(createdProduct.hasTransactions === false, 'Sản phẩm mới tạo mặc định hasTransactions = false');

  // Test 4.3: Chặn trùng SKU (Mã SKU đã tồn tại trên hệ thống)
  try {
    await productsController.create({
      ...newSkuDto,
      sku: 'lh-promo-330ml', // Chữ thường nhưng cùng mã
    });
    assert(false, 'Hệ thống phải ném BadRequestException khi tạo SKU trùng lặp');
  } catch (err: unknown) {
    const error = err as BadRequestException;
    assert(
      error instanceof BadRequestException &&
        error.message === 'Mã SKU đã tồn tại trên hệ thống',
      'Chặn trùng SKU chính xác với thông báo: "Mã SKU đã tồn tại trên hệ thống"',
    );
  }

  // Test 4.4: Chặn SKU chứa khoảng trắng
  try {
    await productsController.create({
      ...newSkuDto,
      sku: 'LH PROMO 330ML', // Khoảng trắng ở giữa
    });
    assert(false, 'Hệ thống phải chặn SKU có khoảng trắng ở giữa');
  } catch (err: unknown) {
    const error = err as BadRequestException;
    assert(
      error instanceof BadRequestException &&
        error.message === 'Mã SKU không được chứa khoảng trắng',
      'Chặn SKU chứa khoảng trắng thành công: "Mã SKU không được chứa khoảng trắng"',
    );
  }

  // Test 4.5: Chặn giá bán <= 0
  try {
    await productsController.create({
      ...newSkuDto,
      sku: 'LH-ZERO-PRICE',
      price: 0,
    });
    assert(false, 'Hệ thống phải chặn giá bán <= 0');
  } catch (err: unknown) {
    assert(
      err instanceof BadRequestException,
      'Chặn thành công giá bán <= 0',
    );
  }

  // Test 4.6: Chặn giá vốn âm
  try {
    await productsController.create({
      ...newSkuDto,
      sku: 'LH-NEG-COST',
      price: 10000,
      costPrice: -5000,
    });
    assert(false, 'Hệ thống phải chặn giá vốn âm');
  } catch (err: unknown) {
    assert(
      err instanceof BadRequestException,
      'Chặn thành công giá vốn âm',
    );
  }

  // =====================================================================
  // PHẦN 5: KIỂM THỬ PATCH /api/products/:id (CẬP NHẬT SKU)
  // =====================================================================
  console.log('\n--- 5. Kiểm thử PATCH /api/products/:id (Cập nhật SKU & Ràng buộc) ---');

  // Test 5.1: Cập nhật giá và tính lại margin
  const updatedProduct = await productsController.update(createdProduct.id, {
    price: 20000, // Giá mới: 20,000, Giá vốn cũ: 9,600
  });
  assert(updatedProduct.price === 20000, 'Cập nhật giá bán thành 20,000 thành công');
  assert(updatedProduct.margin === 52, 'Biên lợi nhuận được tự động tính lại: ((20000 - 9600) / 20000) * 100 = 52%');

  // Test 5.2: Cập nhật SKU mới không trùng
  const updatedSku = await productsController.update(createdProduct.id, {
    sku: 'LH-PROMO-SUMMER',
  });
  assert(updatedSku.sku === 'LH-PROMO-SUMMER', 'Đổi SKU sang LH-PROMO-SUMMER thành công');

  // Test 5.3: Cập nhật SKU trùng với sản phẩm khác trong hệ thống -> BỊ CHẶN
  try {
    await productsController.update(createdProduct.id, {
      sku: 'LH-MILK-900G', // Trùng với prod-001
    });
    assert(false, 'Hệ thống phải chặn đổi SKU trùng với sản phẩm khác');
  } catch (err: unknown) {
    const error = err as BadRequestException;
    assert(
      error instanceof BadRequestException &&
        error.message === 'Mã SKU đã tồn tại trên hệ thống',
      'Chặn cập nhật SKU trùng lặp chính xác: "Mã SKU đã tồn tại trên hệ thống"',
    );
  }

  // Test 5.4: Cập nhật chính SKU của nó -> HỢP LỆ
  const selfUpdate = await productsController.update(createdProduct.id, {
    sku: 'lh-promo-summer', // Cùng mã, khác hoa thường
  });
  assert(selfUpdate.sku === 'LH-PROMO-SUMMER', 'Cập nhật cùng mã SKU của chính sản phẩm được chấp thuận');

  // Test 5.5: Cập nhật sản phẩm không tồn tại -> 404 NotFound
  try {
    await productsController.update('prod-non-existent', { name: 'Mới' });
    assert(false, 'Hệ thống phải ném NotFoundException khi cập nhật ID không tồn tại');
  } catch (err: unknown) {
    assert(err instanceof NotFoundException, 'Ném NotFoundException khi cập nhật ID không tồn tại');
  }

  // =====================================================================
  // PHẦN 6: KIỂM THỬ DELETE /api/products/:id (RÀNG BUỘC TOÀN VẸN DỮ LIỆU)
  // =====================================================================
  console.log('\n--- 6. Kiểm thử DELETE /api/products/:id (Ràng buộc Toàn vẹn Dữ liệu) ---');

  // Test 6.1: Cố tình xóa sản phẩm ĐÃ phát sinh giao dịch (prod-001) -> BẮT BUỘC BỊ TỪ CHỐI
  try {
    await productsController.delete('prod-001');
    assert(false, 'Hệ thống phải chặn xóa sản phẩm đã phát sinh giao dịch');
  } catch (err: unknown) {
    const error = err as BadRequestException;
    assert(
      error instanceof BadRequestException &&
        error.message ===
          'Sản phẩm đã phát sinh giao dịch kho hoặc đơn hàng. Không thể xóa, chỉ được phép chuyển trạng thái sang Ngừng kinh doanh',
      'Từ chối xóa chính xác với thông báo: "Sản phẩm đã phát sinh giao dịch kho hoặc đơn hàng. Không thể xóa, chỉ được phép chuyển trạng thái sang Ngừng kinh doanh"',
    );
  }

  // Test 6.2: Xóa sản phẩm CHƯA phát sinh giao dịch (createdProduct vừa tạo) -> XÓA AN TOÀN
  const deleteResult = await productsController.delete(createdProduct.id);
  assert(deleteResult.success === true, 'Xóa thành công sản phẩm chưa phát sinh giao dịch');

  // Test 6.3: Kiểm tra sản phẩm đã bị xóa hoàn toàn khỏi DB
  try {
    await productsController.findById(createdProduct.id);
    assert(false, 'Sản phẩm đã xóa không được xuất hiện');
  } catch (err: unknown) {
    assert(err instanceof NotFoundException, 'Sản phẩm đã được xóa sạch khỏi danh mục (404 NotFound)');
  }

  // Test 6.4: Xóa sản phẩm không tồn tại -> 404 NotFound
  try {
    await productsController.delete('prod-non-existent-99');
    assert(false, 'Hệ thống phải ném NotFoundException khi xóa ID không tồn tại');
  } catch (err: unknown) {
    assert(err instanceof NotFoundException, 'Ném NotFoundException khi xóa ID không tồn tại');
  }


  console.log('\n========================================================================');
  console.log(`  TỔNG KẾT KIỂM THỬ SUBTASK SN-138: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err: unknown) => {
  console.error('Lỗi khi thực thi test suite SN-138:', err);
  process.exit(1);
});
