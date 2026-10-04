import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SupplierStatus } from '../src/common/enums/supplier-status.enum';
import { SuppliersService } from '../src/modules/suppliers/suppliers.service';

describe('SuppliersService (SN-25: Supplier Management & Constraint Checks)', () => {
  let service: SuppliersService;

  beforeEach(() => {
    service = new SuppliersService();
  });

  describe('findAllPaginated', () => {
    it('should return initial seeded suppliers with pagination', async () => {
      const res = await service.findAllPaginated({ page: 1, limit: 10 });
      expect(res.data.length).toBeGreaterThanOrEqual(5);
      expect(res.total).toBeGreaterThanOrEqual(5);
      expect(res.page).toBe(1);
    });

    it('should filter suppliers by search term (code, name, taxCode, phone)', async () => {
      const resName = await service.findAllPaginated({ search: 'LOHA' });
      expect(resName.data.some((s) => s.code === 'NCC-BEV-01')).toBe(true);

      const resCode = await service.findAllPaginated({ search: 'AQUA-02' });
      expect(resCode.data.length).toBe(1);
      expect(resCode.data[0].code).toBe('NCC-AQUA-02');

      const resTax = await service.findAllPaginated({ search: '0312345678' });
      expect(resTax.data.length).toBe(1);
      expect(resTax.data[0].code).toBe('NCC-BEV-01');
    });

    it('should filter suppliers by status', async () => {
      const activeRes = await service.findAllPaginated({
        status: SupplierStatus.ACTIVE,
      });
      expect(activeRes.data.every((s) => s.status === SupplierStatus.ACTIVE)).toBe(
        true,
      );

      const inactiveRes = await service.findAllPaginated({
        status: SupplierStatus.INACTIVE,
      });
      expect(
        inactiveRes.data.every((s) => s.status === SupplierStatus.INACTIVE),
      ).toBe(true);
      expect(inactiveRes.data.some((s) => s.code === 'NCC-OLD-05')).toBe(true);
    });
  });

  describe('findById', () => {
    it('should find supplier by ID or Code', async () => {
      const byId = await service.findById('22222222-0000-0000-0000-000000000001');
      expect(byId.code).toBe('NCC-BEV-01');

      const byCode = await service.findById('NCC-BEV-01');
      expect(byCode.id).toBe('22222222-0000-0000-0000-000000000001');
    });

    it('should throw NotFoundException when supplier does not exist', async () => {
      await expect(service.findById('NON_EXISTENT')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('should create new supplier with auto-generated code if code is omitted', async () => {
      const newSup = await service.create({
        name: 'Nhà cung cấp Test Mới',
        phone: '0901234567',
        email: 'test@ncc.vn',
        address: 'Hà Nội',
      });

      expect(newSup.id).toBeDefined();
      expect(newSup.code).toMatch(/^NCC-/);
      expect(newSup.name).toBe('Nhà cung cấp Test Mới');
      expect(newSup.status).toBe(SupplierStatus.ACTIVE);
      expect(newSup.hasReceipts).toBe(false);
    });

    it('should throw BadRequestException if code is duplicated', async () => {
      await expect(
        service.create({
          code: 'NCC-BEV-01',
          name: 'Trùng mã NCC',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update & updateStatus', () => {
    it('should update supplier information', async () => {
      const updated = await service.update(
        '22222222-0000-0000-0000-000000000003',
        {
          name: 'Công ty Cổ phần Sữa & Dinh Dưỡng NutriPlus Cập Nhật',
          phone: '0988888888',
        },
      );

      expect(updated.name).toBe(
        'Công ty Cổ phần Sữa & Dinh Dưỡng NutriPlus Cập Nhật',
      );
      expect(updated.phone).toBe('0988888888');
    });

    it('should toggle supplier status', async () => {
      const sup = await service.findById('22222222-0000-0000-0000-000000000003');
      const initialStatus = sup.status;

      const toggled = await service.updateStatus(sup.id);
      expect(toggled.status).not.toBe(initialStatus);

      const toggledBack = await service.updateStatus(sup.id);
      expect(toggledBack.status).toBe(initialStatus);
    });
  });

  describe('DELETE & Import Receipt Constraint Check (Ràng buộc phiếu nhập kho)', () => {
    it('should REJECT delete when supplier already has import receipts', async () => {
      // NCC-BEV-01 has import receipts in seed data
      await expect(
        service.remove('22222222-0000-0000-0000-000000000001'),
      ).rejects.toThrow(BadRequestException);

      try {
        await service.remove('NCC-BEV-01');
      } catch (err: unknown) {
        const error = err as BadRequestException;
        expect(error.message).toContain(
          'Nhà cung cấp đã phát sinh phiếu nhập kho. Không thể xóa',
        );
      }
    });

    it('should ALLOW delete when supplier has NO import receipts', async () => {
      // Create a brand new supplier with 0 receipts
      const created = await service.create({
        code: 'NCC-TEST-CLEAN',
        name: 'Nhà cung cấp Chưa Nhập Hàng',
      });

      const deleteRes = await service.remove(created.id);
      expect(deleteRes.success).toBe(true);

      // Verify it is removed
      await expect(service.findById(created.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
