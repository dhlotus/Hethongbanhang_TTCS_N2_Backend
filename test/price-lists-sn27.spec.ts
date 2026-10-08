import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CustomerGroup } from '../src/common/enums/customer-group.enum';
import { PriceListStatus } from '../src/common/enums/price-list-status.enum';
import { PriceListsController } from '../src/modules/price-lists/price-lists.controller';
import { PriceListsService } from '../src/modules/price-lists/price-lists.service';

async function runPriceListsTestSuite(): Promise<void> {
  console.log('========================================================================');
  console.log('  BẮT ĐẦU KIỂM THỬ TOÀN DIỆN TASK SN-27 (EP-02 / SPRINT 2)');
  console.log('  QUẢN LÝ BẢNG GIÁ & CHIẾT KHẤU B2B / PRICE LIST MANAGEMENT');
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

  const service = new PriceListsService();
  const controller = new PriceListsController(service);

  // 1. Kiểm tra 5 Seed Data nạp sẵn
  console.log('--- NHÓM 1: KIỂM TRA 5 BẢNG GIÁ MẪU SEED DATA (IN-MEMORY) ---');
  const initialLists = await controller.findAll({});
  assert(initialLists.total === 5, 'Hệ thống nạp đúng 5 bảng giá mẫu ban đầu');

  const seed1 = await controller.findById('pl-001');
  assert(
    seed1.code === 'BG-RETAIL-2026' &&
      seed1.customerGroup === CustomerGroup.RETAIL &&
      seed1.status === PriceListStatus.ACTIVE &&
      seed1.hasOrders === false,
    'Bảng giá #1 (Bán lẻ 2026): RETAIL, ACTIVE, hasOrders = false',
  );

  const seed2 = await controller.findById('pl-002');
  assert(
    seed2.code === 'BG-AGENT1-Q4-2026' &&
      seed2.customerGroup === CustomerGroup.AGENT_LEVEL_1 &&
      seed2.status === PriceListStatus.ACTIVE &&
      seed2.hasOrders === true,
    'Bảng giá #2 (Đại lý Cấp 1): AGENT_LEVEL_1, ACTIVE, hasOrders = true (Khóa sửa/xóa)',
  );

  const seed3 = await controller.findById('pl-003');
  assert(
    seed3.code === 'BG-AGENT2-TET-2027' &&
      seed3.customerGroup === CustomerGroup.AGENT_LEVEL_2 &&
      seed3.status === PriceListStatus.ACTIVE &&
      seed3.hasOrders === false,
    'Bảng giá #3 (Đại lý Cấp 2): AGENT_LEVEL_2, ACTIVE, hasOrders = false',
  );

  const seed4 = await controller.findById('pl-004');
  assert(
    seed4.code === 'BG-AGENT1-Q4-2026-V2' &&
      seed4.customerGroup === CustomerGroup.AGENT_LEVEL_1 &&
      seed4.status === PriceListStatus.DRAFT &&
      seed4.version === 2 &&
      seed4.parentVersionId === 'pl-002',
    'Bảng giá #4 (Đại lý Cấp 1 v2.0): DRAFT, version = 2, parentVersionId = pl-002',
  );

  const seed5 = await controller.findById('pl-005');
  assert(
    seed5.code === 'BG-SUMMER-PROMO-2026' &&
      seed5.customerGroup === CustomerGroup.RETAIL &&
      seed5.status === PriceListStatus.EXPIRED &&
      seed5.hasOrders === false,
    'Bảng giá #5 (Khuyến mãi Mùa Hè 2026): RETAIL, EXPIRED',
  );

  // 2. Kiểm tra Tìm kiếm và Lọc
  console.log('\n--- NHÓM 2: TÌM KIẾM VÀ LỌC BẢNG GIÁ ---');
  const searchResult = await controller.findAll({ search: 'Tết' });
  assert(
    searchResult.data.length === 1 && searchResult.data[0].code === 'BG-AGENT2-TET-2027',
    'Tìm kiếm theo từ khóa "Tết" trả về đúng bảng giá Mùa Tết',
  );

  const filterRetail = await controller.findAll({ customerGroup: CustomerGroup.RETAIL });
  assert(
    filterRetail.data.length === 2 &&
      filterRetail.data.every((pl) => pl.customerGroup === CustomerGroup.RETAIL),
    'Lọc theo nhóm khách hàng RETAIL trả về 2 bảng giá',
  );

  const filterExpired = await controller.findAll({ status: PriceListStatus.EXPIRED });
  assert(
    filterExpired.data.length === 1 && filterExpired.data[0].code === 'BG-SUMMER-PROMO-2026',
    'Lọc theo trạng thái EXPIRED trả về đúng bảng giá Mùa Hè',
  );

  // 3. Kiểm tra Validation Giá sàn (Price >= MinPrice)
  console.log('\n--- NHÓM 3: VALIDATION GIÁ SÀN (PRICE >= MINPRICE) ---');
  try {
    await controller.create({
      name: 'Bảng giá lỗi giá sàn',
      customerGroup: CustomerGroup.RETAIL,
      startDate: '2026-10-01',
      endDate: '2026-12-31',
      items: [
        {
          productId: 'prod-001',
          productCode: 'LH-MILK-900G',
          productName: 'Sữa Bột Dinh Dưỡng Cao Cấp Loha Gold 900g',
          price: 350000, // Nhỏ hơn giá sàn 400000
          minPrice: 400000,
        },
      ],
    });
    assert(false, 'Hệ thống phải chặn khi nhập Giá bán < Giá sàn khi tạo mới');
  } catch (err: unknown) {
    const error = err as BadRequestException;
    assert(
      error instanceof BadRequestException &&
        error.message.includes('không được nhỏ hơn giá sàn'),
      'Chặn thành công tạo mới khi Giá bán < Giá sàn (HTTP 400)',
    );
  }

  // 4. Kiểm tra Chặn Sửa và Chặn Xóa khi hasOrders == true
  console.log('\n--- NHÓM 4: RÀNG BUỘC KHÓA SỬA / XÓA KHI ĐÃ CÓ ĐƠN HÀNG (HASORDERS = TRUE) ---');
  try {
    await controller.update('pl-002', { name: 'Đổi tên bất hợp lệ' });
    assert(false, 'Hệ thống phải chặn sửa khi bảng giá đã phát sinh đơn hàng (hasOrders = true)');
  } catch (err: unknown) {
    const error = err as BadRequestException;
    assert(
      error instanceof BadRequestException &&
        error.message.includes('đã phát sinh đơn hàng'),
      'Chặn sửa thành công bảng giá #2 do đã có đơn hàng (HTTP 400)',
    );
  }

  try {
    await controller.remove('pl-002');
    assert(false, 'Hệ thống phải chặn xóa khi bảng giá đã phát sinh đơn hàng (hasOrders = true)');
  } catch (err: unknown) {
    const error = err as BadRequestException;
    assert(
      error instanceof BadRequestException &&
        error.message.includes('đã phát sinh đơn hàng'),
      'Chặn xóa thành công bảng giá #2 do đã có đơn hàng (HTTP 400)',
    );
  }

  // 5. Kiểm tra Cho phép Sửa và Xóa khi hasOrders == false
  console.log('\n--- NHÓM 5: THAO TÁC SỬA / XÓA HỢP LỆ (HASORDERS = FALSE) ---');
  const updated1 = await controller.update('pl-001', {
    name: 'Bảng giá Bán lẻ Niêm yết 2026 - Đã cập nhật',
  });
  assert(
    updated1.name === 'Bảng giá Bán lẻ Niêm yết 2026 - Đã cập nhật',
    'Cập nhật thành công tên bảng giá #1 khi hasOrders = false',
  );

  // 6. Kiểm tra Nhân bản phiên bản mới (Clone Version)
  console.log('\n--- NHÓM 6: NHÂN BẢN PHIÊN BẢN MỚI (CLONE VERSION) ---');
  const cloned = await controller.clone('pl-002', {
    name: 'Bảng giá Đại lý Cấp 1 - Q4/2026 (v3.0)',
  });
  assert(
    cloned.version === 2 &&
      cloned.parentVersionId === 'pl-002' &&
      cloned.hasOrders === false &&
      cloned.status === PriceListStatus.DRAFT &&
      cloned.items.length === 5,
    'Clone bảng giá #2 thành công: version = 2, parentVersionId = pl-002, hasOrders = false, status = DRAFT',
  );

  // 7. Kiểm tra Bật/Tắt trạng thái nhanh (PATCH /status)
  console.log('\n--- NHÓM 7: CẬP NHẬT TRẠNG THÁI NHANH (PATCH STATUS) ---');
  const toggled = await controller.updateStatus('pl-003', {
    status: PriceListStatus.INACTIVE,
  });
  assert(
    toggled.status === PriceListStatus.INACTIVE,
    'Cập nhật trạng thái sang INACTIVE thành công',
  );

  // Tổng kết
  console.log('\n========================================================================');
  console.log(`  KẾT QUẢ KIỂM THỬ: ${passed} PASS, ${failed} FAIL`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runPriceListsTestSuite().catch((err) => {
  console.error('Unhandled test suite error:', err);
  process.exit(1);
});
