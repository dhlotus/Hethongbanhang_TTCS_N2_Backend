import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ShipmentsService } from '../src/modules/shipments/shipments.service';
import { ShipmentsController } from '../src/modules/shipments/shipments.controller';
import { UserRole } from '../src/common/enums/user-role.enum';
import { ICurrentUser } from '../src/modules/auth/interfaces/current-user.interface';
import { ConfirmShipmentDto } from '../src/modules/shipments/dto/confirm-shipment.dto';

/**
 * Bộ kiểm thử toàn diện cho chức năng SN-195:
 * "Là Nhân viên kho, tôi muốn xác nhận xuất kho và xử lý giao thiếu,
 * để phần hàng còn thiếu không bị quên mà được giao ở lượt sau."
 *
 * Tuân thủ nghiêm ngặt các quy chuẩn:
 * - Code Convention (Type Safety, Naming camelCase, PascalCase)
 * - Nghiệp vụ giữ chỗ thành xuất thực, tính nợ hàng, khóa bất biến
 */
describe('Kiểm thử chức năng SN-195: Xác nhận xuất kho & Xử lý giao thiếu', () => {
  let shipmentsService: ShipmentsService;
  let shipmentsController: ShipmentsController;

  const mockWarehouseKeeper: ICurrentUser = {
    userId: 'usr-wh-01',
    username: 'thukho',
    email: 'thukho@loha.vn',
    roles: [UserRole.WAREHOUSE_KEEPER],
  };

  beforeEach(() => {
    shipmentsService = new ShipmentsService();
    shipmentsController = new ShipmentsController(shipmentsService);
  });

  describe('1. Xác nhận xuất kho đầy đủ (Full Delivery)', () => {
    it('TC-195-01: Xác nhận xuất 100% các mặt hàng trong phiếu -> cập nhật trạng thái SHIPPED và khóa phiếu', async () => {
      // shp-003 là phiếu xuất đang ở trạng thái PICKING, chưa xác nhận
      const shipmentBefore = await shipmentsService.findById('shp-003');
      expect(shipmentBefore.isConfirmed).toBe(false);
      expect(shipmentBefore.status).toBe('PICKING');

      const confirmDto: ConfirmShipmentDto = {
        carrierName: 'Giao Hàng Nhanh',
        trackingNumber: 'GHN-2026-999',
        lines: [
          { orderLineId: 'line-003-1', shippedQuantity: 15 },
          { orderLineId: 'line-003-2', shippedQuantity: 30 },
        ],
      };

      const result = await shipmentsService.confirmExport('shp-003', confirmDto, mockWarehouseKeeper);

      expect(result).toBeDefined();
      expect(result.isConfirmed).toBe(true);
      expect(result.status).toBe('SHIPPED');
      expect(result.confirmedBy).toBe('thukho');
      expect(result.hasShortDelivery).toBe(false);
      expect(result.carrierName).toBe('Giao Hàng Nhanh');
      expect(result.trackingNumber).toBe('GHN-2026-999');

      // Từng dòng đều xuất đủ, remainingQuantity = 0
      for (const line of result.lines) {
        expect(line.shippedQuantity).toBe(line.orderedQuantity);
        expect(line.remainingQuantity).toBe(0);
        expect(line.isShortDelivery).toBe(false);
      }
    });
  });

  describe('2. Xử lý xuất thiếu so với đơn (Short Delivery / Giao thiếu)', () => {
    it('TC-195-02: Xuất thiếu 1 dòng hàng -> ghi nhận số lượng nợ hàng và lưu lý do giao thiếu', async () => {
      const confirmDto: ConfirmShipmentDto = {
        carrierName: 'Viettel Post',
        trackingNumber: 'VTP-2026-888',
        lines: [
          // Dòng 1: Đặt 15, xuất đủ 15
          { orderLineId: 'line-003-1', shippedQuantity: 15 },
          // Dòng 2: Đặt 30, chỉ xuất được 20 (thiếu 10 lon do kho hết hàng)
          {
            orderLineId: 'line-003-2',
            shippedQuantity: 20,
            shortDeliveryReason: 'Kho tạm hết hàng, date mới đang về',
          },
        ],
      };

      const result = await shipmentsService.confirmExport('shp-003', confirmDto, mockWarehouseKeeper);

      expect(result.isConfirmed).toBe(true);
      expect(result.hasShortDelivery).toBe(true);

      const line2 = result.lines.find((l) => l.orderLineId === 'line-003-2');
      expect(line2).toBeDefined();
      expect(line2?.orderedQuantity).toBe(30);
      expect(line2?.shippedQuantity).toBe(20);
      expect(line2?.remainingQuantity).toBe(10);
      expect(line2?.isShortDelivery).toBe(true);
      expect(line2?.shortDeliveryReason).toBe('Kho tạm hết hàng, date mới đang về');

      const line1 = result.lines.find((l) => l.orderLineId === 'line-003-1');
      expect(line1?.isShortDelivery).toBe(false);
      expect(line1?.remainingQuantity).toBe(0);
    });

    it('TC-195-03: Báo lỗi nếu số lượng thực xuất âm hoặc vượt quá số lượng khách đặt', async () => {
      await expect(
        shipmentsService.confirmExport('shp-003', {
          lines: [{ orderLineId: 'line-003-1', shippedQuantity: -5 }],
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        shipmentsService.confirmExport('shp-003', {
          lines: [{ orderLineId: 'line-003-1', shippedQuantity: 999 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('3. Ràng buộc tính bất biến (Immutability - Phiếu đã xác nhận không sửa/xóa được)', () => {
    it('TC-195-04: Phiếu xuất đã xác nhận thì không được phép xác nhận lại', async () => {
      // shp-001 đã xác nhận trước đó (isConfirmed = true)
      await expect(
        shipmentsService.confirmExport('shp-001', {}, mockWarehouseKeeper),
      ).rejects.toThrow(BadRequestException);
    });

    it('TC-195-05: Phiếu xuất đã xác nhận thì không được phép xóa', async () => {
      // shp-001 đã xác nhận
      await expect(shipmentsService.remove('shp-001')).rejects.toThrow(BadRequestException);
    });

    it('TC-195-06: Phiếu xuất đã xác nhận không được phép hoàn tác về PENDING / PICKING', async () => {
      await expect(
        shipmentsService.updateStatus('shp-001', 'PICKING'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('4. Quản lý danh sách đơn còn nợ hàng & Tạo phiếu giao bù lượt sau', () => {
    it('TC-195-07: Truy vấn danh sách đơn nợ hàng chỉ trả về các phiếu có hàng thiếu', async () => {
      // Thực hiện xuất thiếu cho shp-003
      await shipmentsService.confirmExport('shp-003', {
        lines: [
          { orderLineId: 'line-003-1', shippedQuantity: 15 },
          { orderLineId: 'line-003-2', shippedQuantity: 22, shortDeliveryReason: 'Thiếu hàng' },
        ],
      });

      const backorders = await shipmentsService.getBackorders();
      expect(backorders.length).toBeGreaterThan(0);
      expect(backorders.some((b) => b.id === 'shp-003')).toBe(true);

      // Tất cả phiếu trong backorders phải có hàng thiếu hoặc còn nợ
      for (const bo of backorders) {
        expect(bo.hasShortDelivery || bo.lines.some((l) => l.remainingQuantity > 0)).toBe(true);
      }
    });

    it('TC-195-08: Tự động tạo phiếu xuất đợt 2 cho phần hàng còn nợ', async () => {
      // Xuất thiếu shp-003 (dòng 2 đặt 30, xuất 18 -> còn nợ 12)
      await shipmentsService.confirmExport('shp-003', {
        lines: [
          { orderLineId: 'line-003-1', shippedQuantity: 15 },
          { orderLineId: 'line-003-2', shippedQuantity: 18, shortDeliveryReason: 'Hàng chưa về đủ' },
        ],
      });

      const backorderShipment = await shipmentsService.createBackorderShipment('ord-003');

      expect(backorderShipment).toBeDefined();
      expect(backorderShipment.orderId).toBe('ord-003');
      expect(backorderShipment.isConfirmed).toBe(false);
      expect(backorderShipment.note).toContain('giao bù');

      // Phiếu đợt 2 chỉ chứa mặt hàng còn nợ (dòng 2: nợ 12)
      expect(backorderShipment.lines.length).toBe(1);
      expect(backorderShipment.lines[0].productSku).toBe('LH-NEST-70ML');
      expect(backorderShipment.lines[0].orderedQuantity).toBe(12);
    });
  });
});
