import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';
import { CategoryStatus } from '../src/common/enums/category-status.enum';
import { UserRole } from '../src/common/enums/user-role.enum';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { CategoriesController } from '../src/modules/categories/categories.controller';
import { CategoriesService } from '../src/modules/categories/categories.service';
import { ProductsService } from '../src/modules/products/products.service';

/**
 * Mock ExecutionContext để giả lập request qua RolesGuard
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
  console.log('  BẮT ĐẦU KIỂM THỬ TOÀN DIỆN SUBTASK SN-150 (USER STORY SN-22 / SPRINT 2)');
  console.log('  QUẢN LÝ NHÓM HÀNG ĐA CẤP (TREE STRUCTURE) & RÀNG BUỘC TOÀN VẸN DỮ LIỆU');
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

  let activeRequiredRoles: (UserRole | string)[] | undefined = undefined;

  const mockReflector = {
    getAllAndOverride: (key: string) => {
      if (key === ROLES_KEY) return activeRequiredRoles;
      return undefined;
    },
  } as unknown as Reflector;

  // Khởi tạo ProductsService và CategoriesService
  const productsService = new ProductsService();
  const categoriesService = new CategoriesService(undefined, productsService);
  const controller = new CategoriesController(categoriesService);

  const rolesGuard = new RolesGuard(mockReflector);

  // --- 1. Kiểm thử Cấu trúc cây danh mục (Tree Structure tối thiểu 3 cấp) ---
  console.log('--- 1. Kiểm thử Cấu trúc Cây Danh mục (Tree Structure) ---');
  const tree = await controller.getCategoryTree();
  assert(Array.isArray(tree), 'API trả về mảng cây danh mục');
  assert(tree.length >= 5, `Số nhóm ngành cha (Cấp 1) >= 5 (thực tế: ${tree.length})`);

  const milkTree = tree.find((c) => c.code === 'MILK');
  assert(!!milkTree, 'Tìm thấy nhóm Cấp 1 Sữa & Chế phẩm sữa (code: MILK)');
  assert(milkTree?.level === 1, 'Nhóm MILK có level = 1');
  assert(!!milkTree?.children && milkTree.children.length >= 3, 'Nhóm MILK có tối thiểu 3 nhóm con cấp 2');

  const powderTree = milkTree?.children.find((c) => c.code === 'MILK_POWDER');
  assert(!!powderTree, 'Tìm thấy nhóm Cấp 2 Sữa bột công thức (code: MILK_POWDER)');
  assert(powderTree?.level === 2, 'Nhóm MILK_POWDER có level = 2');
  assert(!!powderTree?.children && powderTree.children.length >= 2, 'Nhóm MILK_POWDER có nhóm cháu cấp 3');

  const babyPowder = powderTree?.children.find((c) => c.code === 'MILK_POWDER_BABY');
  assert(!!babyPowder, 'Tìm thấy phân loại con Cấp 3 Sữa bột cho trẻ em');
  assert(babyPowder?.level === 3, 'Phân loại con có level = 3');

  // Kiểm tra productCount
  assert(powderTree?.productCount! >= 1, `Nhóm Sữa bột công thức đếm đúng sản phẩm liên kết (productCount: ${powderTree?.productCount})`);

  // --- 2. Kiểm thử Phân quyền RBAC trên Endpoints Quản lý ---
  console.log('\n--- 2. Kiểm thử Phân quyền RBAC (ADMIN, SALES_MANAGER vs các vai trò khác) ---');
  activeRequiredRoles = [UserRole.ADMIN, UserRole.SALES_MANAGER];
  const adminCtx = createMockContext({ role: UserRole.ADMIN }, activeRequiredRoles);
  const managerCtx = createMockContext({ role: UserRole.SALES_MANAGER }, activeRequiredRoles);
  const salesRepCtx = createMockContext({ role: UserRole.SALES_REP }, activeRequiredRoles);
  const warehouseCtx = createMockContext({ role: UserRole.WAREHOUSE_KEEPER }, activeRequiredRoles);
  const customerCtx = createMockContext({ role: UserRole.CUSTOMER }, activeRequiredRoles);

  assert(rolesGuard.canActivate(adminCtx) === true, 'ADMIN được phép truy cập');
  assert(rolesGuard.canActivate(managerCtx) === true, 'SALES_MANAGER được phép truy cập');

  let salesRepBlocked = false;
  try {
    rolesGuard.canActivate(salesRepCtx);
  } catch (err: unknown) {
    salesRepBlocked = err instanceof ForbiddenException;
  }
  assert(salesRepBlocked, 'SALES_REP bị từ chối truy cập (403 Forbidden)');

  let warehouseBlocked = false;
  try {
    rolesGuard.canActivate(warehouseCtx);
  } catch (err: unknown) {
    warehouseBlocked = err instanceof ForbiddenException;
  }
  assert(warehouseBlocked, 'WAREHOUSE_KEEPER bị từ chối truy cập (403 Forbidden)');

  let customerBlocked = false;
  try {
    rolesGuard.canActivate(customerCtx);
  } catch (err: unknown) {
    customerBlocked = err instanceof ForbiddenException;
  }
  assert(customerBlocked, 'CUSTOMER bị từ chối truy cập (403 Forbidden)');

  // --- 3. Kiểm thử POST /api/categories (Tạo mới nhóm hàng & Tính toán Level) ---
  console.log('\n--- 3. Kiểm thử POST /api/categories (Tạo mới & Tính toán Level) ---');

  // 3.1 Tạo nhóm gốc (Cấp 1)
  const rootCat = await controller.create({
    code: 'SNACK',
    name: 'Bánh kẹo & Ăn vặt',
    description: 'Bánh snack, kẹo dinh dưỡng',
  });
  assert(rootCat.code === 'SNACK', 'Tạo nhóm gốc SNACK thành công');
  assert(rootCat.level === 1, 'Nhóm gốc tự động gán level = 1');
  assert(rootCat.parentId === null, 'Nhóm gốc có parentId = null');

  // 3.2 Tạo nhóm con (Cấp 2)
  const subCat = await controller.create({
    code: 'SNACK_CHIPS',
    name: 'Khoai tây sấy giòn',
    parentId: rootCat.id,
  });
  assert(subCat.level === 2, 'Nhóm con cấp 2 tự động tính level = 2 (parent.level + 1)');
  assert(subCat.parentId === rootCat.id, 'Nhóm con lưu đúng parentId của nhóm cha');

  // 3.3 Tạo nhóm cháu (Cấp 3)
  const leafCat = await controller.create({
    code: 'SNACK_CHIPS_SPICY',
    name: 'Khoai tây vị cay nồng',
    parentId: subCat.id,
  });
  assert(leafCat.level === 3, 'Nhóm cháu cấp 3 tự động tính level = 3');

  // 3.4 Chặn trùng mã code
  let duplicateCodeBlocked = false;
  try {
    await controller.create({
      code: 'SNACK',
      name: 'Bánh kẹo trùng mã',
    });
  } catch (err: unknown) {
    if (err instanceof BadRequestException && err.message.includes('đã tồn tại')) {
      duplicateCodeBlocked = true;
    }
  }
  assert(duplicateCodeBlocked, 'Chặn trùng mã code chính xác: "Mã nhóm hàng đã tồn tại trên hệ thống"');

  // 3.5 Báo lỗi nếu parentId không tồn tại
  let nonExistentParentBlocked = false;
  try {
    await controller.create({
      code: 'INVALID_PARENT',
      name: 'Nhóm cha ma',
      parentId: 'cat-non-existent-999',
    });
  } catch (err: unknown) {
    if (err instanceof NotFoundException && err.message.includes('Nhóm hàng cha không tồn tại')) {
      nonExistentParentBlocked = true;
    }
  }
  assert(nonExistentParentBlocked, 'Ném NotFoundException khi parentId không tồn tại: "Nhóm hàng cha không tồn tại"');

  // --- 4. Kiểm thử PATCH /api/categories/:id & Chống Vòng Lặp Vô Tận (Circular Dependency) ---
  console.log('\n--- 4. Kiểm thử PATCH /api/categories/:id & Chống Vòng Lặp Vô Tận ---');

  // 4.1 Cập nhật thông tin thông thường
  const updatedRoot = await controller.update(rootCat.id, {
    name: 'Bánh kẹo & Ăn vặt Cao Cấp',
    description: 'Mô tả đã được cập nhật',
  });
  assert(updatedRoot.name === 'Bánh kẹo & Ăn vặt Cao Cấp', 'Cập nhật tên nhóm thành công');

  // 4.2 Chặn chọn chính nó làm nhóm cha
  let selfParentBlocked = false;
  try {
    await controller.update(rootCat.id, {
      parentId: rootCat.id,
    });
  } catch (err: unknown) {
    if (err instanceof BadRequestException && err.message.includes('vòng lặp vô tận')) {
      selfParentBlocked = true;
    }
  }
  assert(selfParentBlocked, 'Chặn chọn chính nó làm nhóm cha thành công (tránh vòng lặp vô tận)');

  // 4.3 Chặn chọn nhóm con/cháu làm nhóm cha (subCat hoặc leafCat là hậu duệ của rootCat)
  let descendantParentBlocked = false;
  try {
    await controller.update(rootCat.id, {
      parentId: leafCat.id,
    });
  } catch (err: unknown) {
    if (err instanceof BadRequestException && err.message.includes('Không thể chọn nhóm con/cháu làm nhóm cha')) {
      descendantParentBlocked = true;
    }
  }
  assert(descendantParentBlocked, 'Chặn chọn nhóm con/cháu làm nhóm cha thành công');

  // 4.4 Chuyển nhóm cha hợp lệ & Cập nhật đệ quy level của toàn bộ cây con
  // Giả sử chuyển subCat sang trực thuộc cat-bev (level 1) -> subCat thành level 2, leafCat thành level 3
  const reParented = await controller.update(subCat.id, {
    parentId: 'cat-bev',
  });
  assert(reParented.parentId === 'cat-bev', 'Chuyển nhóm cha sang cat-bev thành công');
  assert(reParented.level === 2, 'Level của subCat là 2');
  const leafCheck = await controller.findById(leafCat.id);
  assert(leafCheck.level === 3, 'Level của leafCat tự động cập nhật đệ quy thành 3');

  // --- 5. Kiểm thử POST /api/categories/move-products (Di chuyển sản phẩm) ---
  console.log('\n--- 5. Kiểm thử POST /api/categories/move-products ---');

  // 5.1 Chặn nguồn trùng đích
  let sameSourceTargetBlocked = false;
  try {
    await controller.moveProducts({
      sourceCategoryId: 'cat-milk-powder',
      targetCategoryId: 'cat-milk-powder',
    });
  } catch (err: unknown) {
    if (err instanceof BadRequestException && err.message.includes('phải khác')) {
      sameSourceTargetBlocked = true;
    }
  }
  assert(sameSourceTargetBlocked, 'Chặn nguồn trùng đích chính xác: "Nhóm hàng đích phải khác nhóm hàng nguồn"');

  // 5.2 Di chuyển sản phẩm giữa 2 nhóm
  const moveRes = await controller.moveProducts({
    sourceCategoryId: 'cat-milk-powder',
    targetCategoryId: subCat.id,
    productIds: ['prod-001'],
  });
  assert(moveRes.success === true, 'API di chuyển sản phẩm trả về success = true');
  assert(moveRes.movedCount === 1, 'Chuyển thành công đúng 1 sản phẩm chỉ định');

  const checkProductMoved = await productsService.findById('prod-001');
  assert(checkProductMoved.categoryId === subCat.id, 'Sản phẩm prod-001 đã được cập nhật categoryId mới');

  // Chuyển lại về nhóm cũ
  await controller.moveProducts({
    sourceCategoryId: subCat.id,
    targetCategoryId: 'cat-milk-powder',
    productIds: ['prod-001'],
  });

  // --- 6. Kiểm thử DELETE /api/categories/:id (Ràng buộc toàn vẹn cứng) ---
  console.log('\n--- 6. Kiểm thử DELETE /api/categories/:id (Ràng buộc toàn vẹn dữ liệu) ---');

  // 6.1 RÀNG BUỘC 1: Chặn xóa nhóm đang chứa nhóm con
  let deleteWithChildrenBlocked = false;
  let deleteWithChildrenMsg = '';
  try {
    await controller.delete(subCat.id); // subCat đang chứa leafCat
  } catch (err: unknown) {
    if (err instanceof BadRequestException) {
      deleteWithChildrenBlocked = true;
      deleteWithChildrenMsg = err.message;
    }
  }
  assert(deleteWithChildrenBlocked, 'Chặn xóa nhóm đang chứa nhóm con thành công');
  assert(
    deleteWithChildrenMsg === 'Nhóm hàng đang chứa nhóm hàng con. Vui lòng chuyển hoặc xóa nhóm con trước.',
    `Thông báo lỗi chính xác: "${deleteWithChildrenMsg}"`,
  );

  // 6.2 RÀNG BUỘC 2: Chặn xóa nhóm đang chứa sản phẩm (nhóm không có con nhưng chứa sản phẩm)
  let deleteWithProductsBlocked = false;
  let deleteWithProductsMsg = '';
  try {
    await controller.delete('cat-milk-nut'); // cat-milk-nut không có nhóm con nhưng chứa sản phẩm LH-NUT-180ML
  } catch (err: unknown) {
    if (err instanceof BadRequestException) {
      deleteWithProductsBlocked = true;
      deleteWithProductsMsg = err.message;
    }
  }
  assert(deleteWithProductsBlocked, 'Chặn xóa nhóm đang chứa sản phẩm thành công');
  assert(
    deleteWithProductsMsg === 'Nhóm còn sản phẩm thì không xoá được. Vui lòng chuyển sản phẩm sang nhóm khác trước khi xoá.',
    `Thông báo lỗi chính xác: "${deleteWithProductsMsg}"`,
  );

  // 6.3 Xóa thành công khi nhóm hoàn toàn rỗng
  const deleteLeafRes = await controller.delete(leafCat.id);
  assert(deleteLeafRes.success === true, 'Xóa thành công nhóm cháu leafCat (hoàn toàn rỗng)');

  const deleteEmptySampleRes = await controller.delete('cat-empty-sample');
  assert(deleteEmptySampleRes.success === true, 'Xóa thành công nhóm cat-empty-sample');

  let deletedNotFound = false;
  try {
    await controller.findById(leafCat.id);
  } catch (err: unknown) {
    deletedNotFound = err instanceof NotFoundException;
  }
  assert(deletedNotFound, 'Nhóm hàng đã xóa trả về 404 NotFound');

  // --- TỔNG KẾT ---
  console.log('\n========================================================================');
  console.log(`  TỔNG KẾT KIỂM THỬ SUBTASK SN-150: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Lỗi thực thi kiểm thử SN-150:', err);
  process.exit(1);
});

