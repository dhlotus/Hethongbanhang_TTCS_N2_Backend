/**
 * Cố định danh mục 4 kho chính chuẩn hóa toàn hệ thống (EP-05 & SN-23):
 * 1. Kho Miền Bắc (KHO-MB-01)
 * 2. Kho Miền Trung (KHO-MT-01)
 * 3. Kho Miền Nam (KHO-MN-01)
 * 4. Kho Miền Tây (KHO-WEST-01)
 */

export interface StandardWarehouseDefinition {
  id: string;
  code: string;
  name: string;
  address: string;
  phone: string;
  region: string;
  status: 'ACTIVE' | 'INACTIVE';
}

export const STANDARD_WAREHOUSES: StandardWarehouseDefinition[] = [
  {
    id: '11111111-0000-0000-0000-000000000002',
    code: 'KHO-MB-01',
    name: 'Kho Miền Bắc (Hà Nội)',
    address: 'Lô CN-05 KCN Ninh Hiệp, Gia Lâm, Hà Nội',
    phone: '0243889002',
    region: 'Miền Bắc',
    status: 'ACTIVE',
  },
  {
    id: '11111111-0000-0000-0000-000000000004',
    code: 'KHO-MT-01',
    name: 'Kho Miền Trung (Đà Nẵng)',
    address: 'KCN Hòa Khánh, Liên Chiểu, Đà Nẵng',
    phone: '0236389004',
    region: 'Miền Trung',
    status: 'ACTIVE',
  },
  {
    id: '11111111-0000-0000-0000-000000000001',
    code: 'KHO-MN-01',
    name: 'Kho Miền Nam (TP. Hồ Chí Minh)',
    address: 'Số 18 Đại lộ Độc Lập, KCN Sóng Thần 1, Dĩ An, Bình Dương',
    phone: '0274379001',
    region: 'Miền Nam',
    status: 'ACTIVE',
  },
  {
    id: '11111111-0000-0000-0000-000000000003',
    code: 'KHO-WEST-01',
    name: 'Kho Miền Tây (Cần Thơ)',
    address: 'Đường số 3 KCN Trà Nóc 1, Bình Thủy, Cần Thơ',
    phone: '0292389003',
    region: 'Miền Tây',
    status: 'ACTIVE',
  },
];

export const DEFAULT_WAREHOUSE_ID = '11111111-0000-0000-0000-000000000001';
export const DEFAULT_WAREHOUSE_NAME = 'Kho Miền Nam (TP. Hồ Chí Minh)';
export const DEFAULT_WAREHOUSE_CODE = 'KHO-MN-01';

// Dữ liệu mẫu dùng UUID v4 hợp lệ; tương thích chuẩn RFC 4122 và class-validator IsUUID.
export const WAREHOUSE_MANAGER_ID_PATTERN =
  /^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/;
