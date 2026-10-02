import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UserRole } from '../src/common/enums/user-role.enum';
import { CostPriceSanitizerInterceptor } from '../src/common/interceptors/cost-price-sanitizer.interceptor';
import { ProductsService } from '../src/modules/products/products.service';

/**
 * Suite kiểm thử tự động cho Task SN-138 / SN-139 / SN-20:
 * Quản lý Sản phẩm & SKU Hàng hóa (CRUD, phân trang, lọc, toàn vẹn giao dịch, bảo mật giá vốn)
 */
async function runSN138Tests(): Promise<void> {
  console.log('=== BẮT ĐẦU KIỂM THỬ SN-138: QUẢN LÝ SẢN PHẨM & SKU HÀNG HÓA ===\n');

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

  const productsService = new ProductsService();
  const costPriceSanitizer = new CostPriceSanitizerInterceptor();

  // ---------------------------------------------------------------------------
  // 1. Kiểm thử GET /api/products (Danh sách, Phân trang & Tìm kiếm)
  // ---------------------------------------------------------------------------
  console.log('--- 1. Kiểm thử GET /api/products (Phân trang & Tìm kiếm) ---');

  const defaultList = await productsService.findAll();
  assert(defaultList.total >= 5, `Tổng số sản phẩm mẫu ban đầu: ${defaultList.total}`);
  assert(defaultList.page === 1, 'Trang mặc định là 1');
  assert(defaultList.limit === 20, 'Giới hạn mặc định là 20');
  assert(Array.isArray(defaultList.data), 'Trường data là mảng sản phẩm');

  // Phân trang với limit nhỏ
  const paginated = await productsService.findAll({ page: 1, limit: 2 });
  assert(paginated.data.length === 2, 'Phân trang lấy đúng 2 sản phẩm');
  assert(paginated.totalPages >= 3, `Tính đúng tổng số trang: ${paginated.totalPages}`);

  // Tìm kiếm theo tên / SKU / barcode
  const searchBySku = await productsService.findAll({ search: 'MILK' });
  assert(
    searchBySku.data.length > 0 && searchBySku.data[0].sku === 'LH-MILK-900G',
    'Tìm kiếm theo SKU "MILK" chính xác',
  );

  const searchByName = await productsService.findAll({ search: 'Tổ yến' });
  assert(
    searchByName.data.length > 0 && searchByName.data[0].sku === 'LH-NEST-70ML',
    'Tìm kiếm theo tên sản phẩm "Tổ yến" chính xác',
  );

  const searchByBarcode = await productsService.findAll({ search: '8936012345028' });
  assert(
    searchByBarcode.data.length === 1 && searchByBarcode.data[0].sku === 'LH-NUT-180ML',
    'Tìm kiếm theo Barcode chính xác',
  );

  // Lọc theo ngành hàng cha và con
  const filterByParent = await productsService.findAll({ parentCategory: 'Sữa & Chế phẩm sữa' });
  assert(
    filterByParent.data.length >= 2,
    `Lọc theo ngành hàng cha "Sữa & Chế phẩm sữa": ${filterByParent.data.length} sản phẩm`,
  );

  const filterBySub = await productsService.findAll({ subCategory: 'Sữa bột công thức' });
  assert(
    filterBySub.data.length === 1 && filterBySub.data[0].sku === 'LH-MILK-900G',
    'Lọc theo ngành hàng con "Sữa bột công thức" chính xác',
  );

  // ---------------------------------------------------------------------------
  // 2. Kiểm thử GET /api/products/:id (Chi tiết sản phẩm)
  // ---------------------------------------------------------------------------
  console.log('\n--- 2. Kiểm thử GET /api/products/:id ---');

  const foundById = await productsService.findById('prod-001');
  assert(foundById.sku === 'LH-MILK-900G', 'Tìm thấy sản phẩm theo ID prod-001');

  const foundBySku = await productsService.findById('lh-nut-180ml');
  assert(foundBySku.id === 'prod-002', 'Tìm thấy sản phẩm theo SKU không phân biệt hoa thường');

  try {
    await productsService.findById('non-existent-sku');
    assert(false, 'Phải ném 404 khi sản phẩm không tồn tại');
  } catch (err: any) {
    assert(
      err instanceof NotFoundException &&
        err.message.includes('Không tìm thấy sản phẩm'),
      'Ném chính xác 404 NotFoundException cho sản phẩm không tồn tại',
    );
  }

  // ---------------------------------------------------------------------------
  // 3. Kiểm thử POST /api/products (Thêm mới SKU sản phẩm)
  // ---------------------------------------------------------------------------
  console.log('\n--- 3. Kiểm thử POST /api/products (Thêm mới SKU) ---');

  const newProduct = await productsService.create({
    sku: 'LH-WHEY-1KG',
    name: 'Đạm Thực Vật Hữu Cơ Loha Pro Whey 1kg',
    parentCategory: 'Dinh Dưỡng Thể Thao',
    subCategory: 'Whey Protein',
    baseUnit: 'Hộp',
    packagingSpec: '12 hộp/thùng',
    price: 890000,
    costPrice: 590000,
    status: 'ACTIVE',
    barcode: '8936012345099',
    description: 'Protein thực vật hữu cơ cao cấp',
  });

  assert(newProduct.sku === 'LH-WHEY-1KG', 'Tạo sản phẩm mới với SKU in hoa chuẩn');
  assert(newProduct.margin === 33.71, `Tự động tính biên lợi nhuận chính xác: ${newProduct.margin}%`);
  assert(newProduct.hasTransactions === false, 'Sản phẩm mới khởi tạo có hasTransactions = false');
  assert(
    newProduct.category === 'Dinh Dưỡng Thể Thao / Whey Protein',
    'Tự động đồng bộ cây phân cấp ngành hàng category',
  );

  // Thử tạo trùng SKU -> phải ném 400 Bad Request
  try {
    await productsService.create({
      sku: 'lh-whey-1kg', // Viết thường nhưng cùng SKU
      name: 'Sản phẩm trùng mã',
      baseUnit: 'Hộp',
      price: 100000,
    });
    assert(false, 'Hệ thống phải chặn khi SKU đã tồn tại');
  } catch (err: any) {
    assert(
      err instanceof BadRequestException &&
        err.message === 'Mã SKU đã tồn tại trên hệ thống',
      'Chặn trùng SKU thành công với thông báo: "Mã SKU đã tồn tại trên hệ thống"',
    );
  }

  // ---------------------------------------------------------------------------
  // 4. Kiểm thử PATCH /api/products/:id (Cập nhật thông tin SKU)
  // ---------------------------------------------------------------------------
  console.log('\n--- 4. Kiểm thử PATCH /api/products/:id ---');

  const updatedProduct = await productsService.update(newProduct.id, {
    name: 'Đạm Thực Vật Hữu Cơ Loha Pro Whey Plus 1kg (Nâng cấp)',
    price: 950000,
    costPrice: 600000,
  });

  assert(
    updatedProduct.name.includes('(Nâng cấp)'),
    'Cập nhật thành công tên sản phẩm',
  );
  assert(
    updatedProduct.margin === 36.84,
    `Tự động tính lại biên lợi nhuận sau khi đổi giá: ${updatedProduct.margin}%`,
  );

  // Cập nhật trùng SKU với một sản phẩm khác
  try {
    await productsService.update(newProduct.id, {
      sku: 'LH-MILK-900G', // Trùng với prod-001
    });
    assert(false, 'Hệ thống phải chặn khi đổi SKU trùng với sản phẩm khác');
  } catch (err: any) {
    assert(
      err instanceof BadRequestException &&
        err.message === 'Mã SKU đã tồn tại trên hệ thống',
      'Chặn đổi SKU trùng với sản phẩm khác thành công (400 Bad Request)',
    );
  }

  // ---------------------------------------------------------------------------
  // 5. Kiểm thử DELETE /api/products/:id (Ràng buộc toàn vẹn giao dịch)
  // ---------------------------------------------------------------------------
  console.log('\n--- 5. Kiểm thử DELETE /api/products/:id (Ràng buộc giao dịch) ---');

  // 5.1 Thử xóa sản phẩm đã có giao dịch (prod-001 hasTransactions = true) -> Phải bị chặn
  try {
    await productsService.delete('prod-001');
    assert(false, 'Hệ thống phải chặn xóa sản phẩm đã có giao dịch kho/đơn hàng');
  } catch (err: any) {
    assert(
      err instanceof BadRequestException &&
        err.message ===
          'Sản phẩm đã phát sinh giao dịch kho hoặc đơn hàng. Không thể xóa, chỉ được phép chuyển trạng thái sang Ngừng kinh doanh',
      'Chặn xóa thành công sản phẩm đã phát sinh giao dịch với thông báo chuẩn API contract',
    );
  }

  // 5.2 Xóa an toàn sản phẩm chưa có giao dịch (newProduct vừa tạo có hasTransactions = false)
  const deleteResult = await productsService.delete(newProduct.id);
  assert(deleteResult.success === true, 'Xóa an toàn sản phẩm chưa có giao dịch thành công');
  assert(deleteResult.deletedId === newProduct.id, 'Trả về deletedId chính xác');

  // Xác nhận sản phẩm đã xóa không còn tồn tại
  try {
    await productsService.findById(newProduct.id);
    assert(false, 'Sản phẩm đã xóa không được phép tồn tại trong danh mục');
  } catch (err: any) {
    assert(err instanceof NotFoundException, 'Xác nhận sản phẩm đã bị xóa khỏi CSDL');
  }

  // ---------------------------------------------------------------------------
  // 6. Kiểm thử CostPriceSanitizerInterceptor (Bảo mật giá vốn & biên lợi nhuận)
  // ---------------------------------------------------------------------------
  console.log('\n--- 6. Kiểm thử Bảo mật giá vốn Cost Price & Margin (SN-10) ---');

  const fullData = await productsService.findAll();

  // 6.1 Mô phỏng người dùng vai trò Kinh doanh (SALES_REP) hoặc Thủ kho
  const sanitizedForSalesRep = costPriceSanitizer.sanitizeData(fullData);
  const firstItem = sanitizedForSalesRep.data[0];
  assert(firstItem.costPrice === undefined, 'Tự động loại bỏ hoàn toàn costPrice đối với vai trò bán hàng');
  assert(firstItem.margin === undefined, 'Tự động loại bỏ hoàn toàn margin đối với vai trò bán hàng');
  assert(firstItem.price !== undefined && firstItem.price > 0, 'Giữ nguyên giá bán công khai price');
  assert(firstItem.sku !== undefined, 'Giữ nguyên mã SKU');

  // 6.2 Mô phỏng người dùng Quản trị viên (ADMIN)
  // Admin được giữ nguyên cấu trúc gốc
  assert(fullData.data[0].costPrice !== undefined, 'Quản trị viên ADMIN xem đầy đủ costPrice');
  assert(fullData.data[0].margin !== undefined, 'Quản trị viên ADMIN xem đầy đủ margin');

  console.log('\n======================================================');
  console.log(`KẾT QUẢ: ${passedCount} PASS, ${failedCount} FAIL`);
  console.log('======================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runSN138Tests().catch((err) => {
  console.error('Lỗi ngoài dự kiến khi chạy kiểm thử SN-138:', err);
  process.exit(1);
});
