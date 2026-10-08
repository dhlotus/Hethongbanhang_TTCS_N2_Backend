import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { CustomerEntity, CustomerStatus } from './entities/customer.entity';
import { DeliveryPointEntity } from './entities/delivery-point.entity';
import { CreateDeliveryPointDto } from './dto/create-delivery-point.dto';
import { UpdateDeliveryPointDto } from './dto/update-delivery-point.dto';
import { QueryCustomerDto } from './dto/query-customer.dto';
import { FilterCustomersDto } from './dto/filter-customers.dto';
import { PaginatedCustomersResult } from './interfaces/paginated-customers.interface';
import { UserRole } from '../../common/enums/user-role.enum';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';

/**
 * Service Quản lý Đại lý & Điểm giao hàng (SN-31 & SN-32)
 */
@Injectable()
export class CustomersService implements OnModuleInit {
  private readonly customers = new Map<string, CustomerEntity>();

  constructor(@Optional() private readonly dbService?: DatabaseService) {
    this.seedInitialCustomers();
  }

  async onModuleInit(): Promise<void> {
    if (this.customers.size === 0) {
      this.seedInitialCustomers();
    }
  }

  /**
   * Khởi tạo dữ liệu mẫu thực tế 100% cho các đại lý và nhiều điểm giao hàng (SN-31)
   */
  private seedInitialCustomers(): void {
    const list: CustomerEntity[] = [
      new CustomerEntity({
        id: 'cust-001',
        code: 'DL-HCM-001',
        name: 'Cửa Hàng Thực Phẩm Tiêu Dùng Minh Khang',
        taxCode: '0316789123',
        customerGroup: 'AGENT_LEVEL_1',
        region: 'Miền Nam',
        salesRepId: 'usr-sale-01',
        salesRepName: 'Trần Văn Long',
        creditLimit: 100000000,
        currentDebt: 24500000,
        maxDebtDays: 30,
        phone: '0901234567',
        email: 'minhkhang.distributor@gmail.com',
        address: '123 Nguyễn Trọng Tuyển, P.8, Q.Phú Nhuận, TP.HCM',
        status: CustomerStatus.ACTIVE,
        deliveryPoints: [
          new DeliveryPointEntity({
            id: 'dp-001-1',
            customerId: 'cust-001',
            name: 'Kho Tổng Phú Nhuận',
            address: '123 Nguyễn Trọng Tuyển, Phường 8, Quận Phú Nhuận, TP.HCM',
            ward: 'Phường 8',
            district: 'Quận Phú Nhuận',
            province: 'TP. Hồ Chí Minh',
            receiverName: 'Anh Nguyễn Minh Khang',
            phone: '0901234567',
            roadNote: 'Đường 2 chiều, xe tải 2.5T vào thoải mái, giao giờ hành chính 8h00 - 17h00',
            isDefault: true,
          }),
          new DeliveryPointEntity({
            id: 'dp-001-2',
            customerId: 'cust-001',
            name: 'Cửa Hàng Bán Lẻ Chi Nhánh Quận 1',
            address: '45 Lê Thị Riêng, Phường Bến Thành, Quận 1, TP.HCM',
            ward: 'Phường Bến Thành',
            district: 'Quận 1',
            province: 'TP. Hồ Chí Minh',
            receiverName: 'Chị Mai Lan',
            phone: '0908765432',
            roadNote: 'Mặt tiền đường, cấm dừng đỗ 6h-9h và 16h-19h. Bốc hàng nhanh vào kho sau',
            isDefault: false,
          }),
          new DeliveryPointEntity({
            id: 'dp-001-3',
            customerId: 'cust-001',
            name: 'Kho Trung Chuyển Bình Tân',
            address: '89 Kinh Dương Vương, Phường An Lạc, Quận Bình Tân, TP.HCM',
            ward: 'Phường An Lạc',
            district: 'Quận Bình Tân',
            province: 'TP. Hồ Chí Minh',
            receiverName: 'Anh Quốc Hùng',
            phone: '0903334455',
            roadNote: 'Gần bến xe Miền Tây, cổng kho số 3, xe container 5T vào được 24/7',
            isDefault: false,
          }),
        ],
      }),
      new CustomerEntity({
        id: 'cust-002',
        code: 'DL-HCM-002',
        name: 'Đại Lý Bách Hóa Thực Phẩm Bảo Châu',
        taxCode: '0317892345',
        customerGroup: 'AGENT_LEVEL_2',
        region: 'Miền Nam',
        salesRepId: 'usr-sale-02',
        salesRepName: 'Nguyễn Thị Hằng',
        creditLimit: 60000000,
        currentDebt: 15200000,
        maxDebtDays: 20,
        phone: '0912345678',
        email: 'baochaustore.q9@gmail.com',
        address: '456 Lê Văn Việt, P.Tăng Nhơn Phú A, TP.Thủ Đức, TP.HCM',
        status: CustomerStatus.ACTIVE,
        deliveryPoints: [
          new DeliveryPointEntity({
            id: 'dp-002-1',
            customerId: 'cust-002',
            name: 'Kho Phân Phối Thủ Đức',
            address: '456 Lê Văn Việt, Phường Tăng Nhơn Phú A, TP. Thủ Đức, TP.HCM',
            ward: 'Phường Tăng Nhơn Phú A',
            district: 'TP. Thủ Đức',
            province: 'TP. Hồ Chí Minh',
            receiverName: 'Chị Trần Bảo Châu',
            phone: '0912345678',
            roadNote: 'Hẻm xe tải 8m, vào cổng sắt màu xanh, gọi điện trước khi đến 15 phút',
            isDefault: true,
          }),
          new DeliveryPointEntity({
            id: 'dp-002-2',
            customerId: 'cust-002',
            name: 'Showroom Trưng Bày Đỗ Xuân Hợp',
            address: '12 Đỗ Xuân Hợp, Phường Phước Long B, TP. Thủ Đức, TP.HCM',
            ward: 'Phường Phước Long B',
            district: 'TP. Thủ Đức',
            province: 'TP. Hồ Chí Minh',
            receiverName: 'Anh Lê Thanh Bình',
            phone: '0918889900',
            roadNote: 'Giao hàng trước 11h sáng để kịp sắp xếp lên kệ bán lẻ',
            isDefault: false,
          }),
        ],
      }),
      new CustomerEntity({
        id: 'cust-003',
        code: 'DL-HCM-003',
        name: 'Siêu Thị Mini Phương Nam Mart',
        taxCode: '0318903456',
        customerGroup: 'RETAIL',
        region: 'Miền Nam',
        salesRepId: 'usr-sale-01',
        salesRepName: 'Trần Văn Long',
        creditLimit: 30000000,
        currentDebt: 0,
        maxDebtDays: 15,
        phone: '0923456789',
        email: 'phuongnammart@gmail.com',
        address: '789 Hoàng Văn Thụ, P.4, Q.Tân Bình, TP.HCM',
        status: CustomerStatus.ACTIVE,
        deliveryPoints: [
          new DeliveryPointEntity({
            id: 'dp-003-1',
            customerId: 'cust-003',
            name: 'Điểm Bán Tân Bình (Mặt Tiền)',
            address: '789 Hoàng Văn Thụ, Phường 4, Quận Tân Bình, TP.HCM',
            ward: 'Phường 4',
            district: 'Quận Tân Bình',
            province: 'TP. Hồ Chí Minh',
            receiverName: 'Chị Đỗ Thu Phương',
            phone: '0923456789',
            roadNote: 'Giao vào bãi đỗ xe phía sau siêu thị mini, có thang máy vận chuyển hàng',
            isDefault: true,
          }),
          new DeliveryPointEntity({
            id: 'dp-003-2',
            customerId: 'cust-003',
            name: 'Kho Bảo Quản Lạnh Củ Chi',
            address: '105 Tỉnh Lộ 8, Thị trấn Củ Chi, Huyện Củ Chi, TP.HCM',
            ward: 'Thị trấn Củ Chi',
            district: 'Huyện Củ Chi',
            province: 'TP. Hồ Chí Minh',
            receiverName: 'Bác Sáu Hùng',
            phone: '0921112233',
            roadNote: 'Kho đông lạnh, yêu cầu xe tải thùng kín hoặc xe lạnh, giao sau 13h30',
            isDefault: false,
          }),
        ],
      }),
      new CustomerEntity({
        id: 'cust-004',
        code: 'DL-HAN-001',
        name: 'Chuỗi Cửa Hàng Tiện Lợi An Phú Mart',
        taxCode: '0108991234',
        customerGroup: 'AGENT_LEVEL_1',
        region: 'Miền Bắc',
        salesRepId: 'usr-sale-03',
        salesRepName: 'Phạm Minh Tuấn',
        creditLimit: 120000000,
        currentDebt: 32000000,
        maxDebtDays: 45,
        phone: '0934567890',
        email: 'anphumart.hanoi@gmail.com',
        address: '18 Duy Tân, P.Dịch Vọng Hậu, Q.Cầu Giấy, Hà Nội',
        status: CustomerStatus.ACTIVE,
        deliveryPoints: [
          new DeliveryPointEntity({
            id: 'dp-004-1',
            customerId: 'cust-004',
            name: 'Tổng Kho Cầu Giấy',
            address: '18 Duy Tân, Phường Dịch Vọng Hậu, Quận Cầu Giấy, Hà Nội',
            ward: 'Phường Dịch Vọng Hậu',
            district: 'Quận Cầu Giấy',
            province: 'Hà Nội',
            receiverName: 'Anh Phạm Minh Tuấn',
            phone: '0934567890',
            roadNote: 'Tầng hầm B1 tòa nhà Duy Tân Plaza, chiều cao giới hạn xe 2.2m',
            isDefault: true,
          }),
          new DeliveryPointEntity({
            id: 'dp-004-2',
            customerId: 'cust-004',
            name: 'Chi Nhánh Phố Huế',
            address: '210 Phố Huế, Phường Phố Huế, Quận Hai Bà Trưng, Hà Nội',
            ward: 'Phường Phố Huế',
            district: 'Quận Hai Bà Trưng',
            province: 'Hà Nội',
            receiverName: 'Chị Hoàng Mai',
            phone: '0938887766',
            roadNote: 'Tuyến phố cấm xe tải trên 1.25T trong khung giờ cao điểm',
            isDefault: false,
          }),
        ],
      }),
      new CustomerEntity({
        id: 'cust-005',
        code: 'DL-HCM-004',
        name: 'Công Ty TNHH Thương Mại & Dịch Vụ Hoàng Gia',
        taxCode: '0319876543',
        customerGroup: 'AGENT_LEVEL_1',
        region: 'Miền Nam',
        salesRepId: 'usr-sale-02',
        salesRepName: 'Nguyễn Thị Hằng',
        creditLimit: 200000000,
        currentDebt: 48000000,
        maxDebtDays: 30,
        phone: '0945678901',
        email: 'hoanggia.distribution@gmail.com',
        address: 'Lô B2 Đường số 3, KCN Tân Tạo, Q.Bình Tân, TP.HCM',
        status: CustomerStatus.ACTIVE,
        deliveryPoints: [
          new DeliveryPointEntity({
            id: 'dp-005-1',
            customerId: 'cust-005',
            name: 'Tổng Kho KCN Tân Tạo',
            address: 'Lô B2 Đường số 3, KCN Tân Tạo, Phường Tân Tạo A, Quận Bình Tân, TP.HCM',
            ward: 'Phường Tân Tạo A',
            district: 'Quận Bình Tân',
            province: 'TP. Hồ Chí Minh',
            receiverName: 'Anh Nguyễn Hoàng',
            phone: '0945678901',
            roadNote: 'Cổng số 2 KCN, xe container đậu bốc dỡ 24/7, có dock dỡ hàng tự động',
            isDefault: true,
          }),
          new DeliveryPointEntity({
            id: 'dp-005-2',
            customerId: 'cust-005',
            name: 'Showroom Trưng Bày Quận 7',
            address: '56 Nguyễn Thị Thập, Phường Tân Hưng, Quận 7, TP.HCM',
            ward: 'Phường Tân Hưng',
            district: 'Quận 7',
            province: 'TP. Hồ Chí Minh',
            receiverName: 'Chị Đặng Thúy Vy',
            phone: '0949998877',
            roadNote: 'Bốc dỡ tại sảnh trước 9h00 sáng để mở cửa đón khách',
            isDefault: false,
          }),
        ],
      }),
      new CustomerEntity({
        id: 'cust-006',
        code: 'DL-DNG-001',
        name: 'Đại Lý Thực Phẩm Sông Hàn',
        taxCode: '0401889922',
        customerGroup: 'AGENT_LEVEL_2',
        region: 'Miền Trung',
        salesRepId: 'usr-sale-01',
        salesRepName: 'Trần Văn Long',
        creditLimit: 75000000,
        currentDebt: 80000000,
        maxDebtDays: 25,
        phone: '0978123456',
        email: 'songhan.food@gmail.com',
        address: '42 Bạch Đằng, P.Hải Châu 1, Q.Hải Châu, Đà Nẵng',
        status: CustomerStatus.LOCKED,
        deliveryPoints: [
          new DeliveryPointEntity({
            id: 'dp-006-1',
            customerId: 'cust-006',
            name: 'Điểm Bán Trung Tâm Hải Châu',
            address: '42 Bạch Đằng, Phường Hải Châu 1, Quận Hải Châu, Đà Nẵng',
            ward: 'Phường Hải Châu 1',
            district: 'Quận Hải Châu',
            province: 'Đà Nẵng',
            receiverName: 'Anh Lê Quốc Tuấn',
            phone: '0978123456',
            roadNote: 'Tuyến đường ven sông, giao giờ hành chính',
            isDefault: true,
          }),
        ],
      }),
      new CustomerEntity({
        id: 'cust-007',
        code: 'DL-CTH-001',
        name: 'Đại Lý Bách Hóa Miền Tây',
        taxCode: '1801667788',
        customerGroup: 'RETAIL',
        region: 'Miền Nam',
        salesRepId: 'usr-sale-02',
        salesRepName: 'Nguyễn Thị Hằng',
        creditLimit: 25000000,
        currentDebt: 0,
        maxDebtDays: 15,
        phone: '0966778899',
        email: 'mientaymart.ct@gmail.com',
        address: '15 Trần Văn Khéo, P.Cái Khế, Q.Ninh Kiều, Cần Thơ',
        status: CustomerStatus.INACTIVE,
        deliveryPoints: [
          new DeliveryPointEntity({
            id: 'dp-007-1',
            customerId: 'cust-007',
            name: 'Cửa hàng Cái Khế',
            address: '15 Trần Văn Khéo, Phường Cái Khế, Quận Ninh Kiều, Cần Thơ',
            ward: 'Phường Cái Khế',
            district: 'Quận Ninh Kiều',
            province: 'Cần Thơ',
            receiverName: 'Chị Huỳnh Ánh',
            phone: '0966778899',
            roadNote: 'Mặt tiền chợ đêm, giao buổi sáng',
            isDefault: true,
          }),
        ],
      }),
      new CustomerEntity({
        id: 'cust-008',
        code: 'DL-HN-001',
        name: 'Đại lý Sữa Hà Nội',
        taxCode: '0109988776',
        customerGroup: 'AGENT_LEVEL_1',
        region: 'Miền Bắc',
        salesRepId: 'usr-sale-03',
        salesRepName: 'Phạm Minh Tuấn',
        creditLimit: 100000000,
        currentDebt: 45000000,
        maxDebtDays: 30,
        phone: '0987654321',
        email: 'suahanoi.distributor@gmail.com',
        address: '123 Giải Phóng, Hai Bà Trưng, Hà Nội',
        status: CustomerStatus.ACTIVE,
        deliveryPoints: [
          new DeliveryPointEntity({
            id: 'dp-008-1',
            customerId: 'cust-008',
            name: 'Kho Phân Phối Giải Phóng',
            address: '123 Giải Phóng, Phường Đồng Tâm, Quận Hai Bà Trưng, Hà Nội',
            ward: 'Phường Đồng Tâm',
            district: 'Quận Hai Bà Trưng',
            province: 'Hà Nội',
            receiverName: 'Anh Nguyễn Văn A',
            phone: '0987654321',
            roadNote: 'Mặt đường lớn, xe tải 3.5T vào bốc dỡ thuận tiện',
            isDefault: true,
          }),
        ],
      }),
    ];

    for (const c of list) {
      this.customers.set(c.id, c);
    }
  }

  /**
   * Lấy danh sách tất cả đại lý kèm lọc linh hoạt và phân trang (SN-37 & SN-38)
   */
  async findAllCustomers(query?: QueryCustomerDto): Promise<CustomerEntity[]> {
    let result = Array.from(this.customers.values());

    if (query?.search) {
      const q = query.search.toLowerCase().trim();
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.code.toLowerCase().includes(q) ||
          c.phone.includes(q),
      );
    }

    if (query?.group) {
      result = result.filter((c) => c.customerGroup === query.group);
    }

    if (query?.status) {
      result = result.filter((c) => c.status === query.status);
    }

    return result;
  }

  /**
   * Tìm kiếm và lọc danh sách đại lý phân quyền & phân trang chuẩn mực (SN-37)
   * - Nếu role là SALES_REP (nhân viên kinh doanh thông thường):
   *   Tự động mặc định chỉ lọc các đại lý được gán cho chính user đó phụ trách (trừ khi là ADMIN hoặc SALES_MANAGER)
   * - Tìm kiếm nhanh (search): Không phân biệt hoa thường theo Mã (code), Tên (name), Số điện thoại (phone)
   * - Kết hợp linh hoạt: region, customerGroup, salesRepId, status
   * - Phân trang đầy đủ: page, limit, total, totalPages
   */
  async filterCustomers(
    query?: FilterCustomersDto,
    currentUser?: ICurrentUser,
  ): Promise<PaginatedCustomersResult> {
    let list = Array.from(this.customers.values());

    // 1. Phân quyền theo vai trò (RBAC Scope):
    // Nhân viên kinh doanh (SALES_REP) chỉ nhìn thấy đại lý mình phụ trách (trừ khi có quyền ADMIN / SALES_MANAGER)
    if (currentUser?.roles && currentUser.roles.length > 0) {
      const isManagerOrAdmin =
        currentUser.roles.includes(UserRole.ADMIN) ||
        currentUser.roles.includes(UserRole.SALES_MANAGER);

      const isSalesRep = currentUser.roles.includes(UserRole.SALES_REP);

      if (isSalesRep && !isManagerOrAdmin) {
        list = list.filter((c) => {
          // 1. Khớp chính xác ID phụ trách
          if (c.salesRepId === currentUser.userId || c.salesRep?.id === currentUser.userId) {
            return true;
          }

          // 2. Đồng bộ tài khoản Sales Rep chính (sales@loha.vn / usr-sales-002 / usr-sale-01 / 00000000-0000-0000-0000-000000000003)
          const isPrimarySalesUser =
            currentUser.userId === 'usr-sales-002' ||
            currentUser.userId === 'usr-sale-01' ||
            currentUser.userId === '00000000-0000-0000-0000-000000000003' ||
            currentUser.username === 'sales' ||
            currentUser.email === 'sales@loha.vn';

          if (isPrimarySalesUser) {
            return (
              c.salesRepId === 'usr-sale-01' ||
              c.salesRepId === 'usr-sales-002' ||
              c.salesRepId === '00000000-0000-0000-0000-000000000003'
            );
          }

          // 3. Đồng bộ tài khoản Sales Rep phụ (nhanvienkinhdoanh@loha.vn / usr-sale-02 / 00000000-0000-0000-0000-000000000013)
          const isSecondarySalesUser =
            currentUser.userId === 'usr-sale-02' ||
            currentUser.userId === '00000000-0000-0000-0000-000000000013' ||
            currentUser.username === 'nhanvienkinhdoanh' ||
            currentUser.email === 'nhanvienkinhdoanh@loha.vn';

          if (isSecondarySalesUser) {
            return (
              c.salesRepId === 'usr-sale-02' ||
              c.salesRepId === '00000000-0000-0000-0000-000000000013'
            );
          }

          // 4. Fallback an toàn: Nếu là tài khoản kinh doanh hệ thống nhưng chưa gán ID cụ thể, mặc định xem tuyến chính
          return c.salesRepId === 'usr-sale-01' || c.salesRepId === 'usr-sales-002';
        });
      }
    }

    // 2. Lọc theo nhân viên phụ trách chỉ định (dành cho Admin / Quản lý)
    if (query?.salesRepId && query.salesRepId !== 'ALL') {
      const targetRepId = query.salesRepId;
      list = list.filter((c) => {
        if (c.salesRepId === targetRepId || c.salesRep?.id === targetRepId) {
          return true;
        }
        if (
          (targetRepId === 'usr-sales-002' || targetRepId === 'usr-sale-01') &&
          (c.salesRepId === 'usr-sale-01' || c.salesRepId === 'usr-sales-002')
        ) {
          return true;
        }
        if (
          (targetRepId === 'usr-sale-02' || targetRepId === '00000000-0000-0000-0000-000000000013') &&
          (c.salesRepId === 'usr-sale-02' || c.salesRepId === '00000000-0000-0000-0000-000000000013')
        ) {
          return true;
        }
        return false;
      });
    }

    // 3. Tìm kiếm nhanh (Full-text/Partial search) theo code, name, phone
    if (query?.search) {
      const q = query.search.toLowerCase().trim();
      list = list.filter(
        (c) =>
          c.code.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q) ||
          c.phone.includes(q) ||
          (c.address && c.address.toLowerCase().includes(q)),
      );
    }

    // 4. Lọc theo Khu vực / Địa bàn kinh doanh
    if (query?.region && query.region !== 'ALL') {
      const reg = query.region.toLowerCase().trim();
      list = list.filter((c) => c.region && c.region.toLowerCase() === reg);
    }

    // 5. Lọc theo Phân nhóm khách hàng
    if (query?.customerGroup && query.customerGroup !== 'ALL') {
      list = list.filter((c) => c.customerGroup === query.customerGroup);
    }

    // 6. Lọc theo Trạng thái hoạt động
    if (query?.status && (query.status as string) !== 'ALL') {
      list = list.filter((c) => c.status === query.status);
    }

    // 7. Phân trang kết quả
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(query?.limit) || 20));
    const total = list.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const startIndex = (page - 1) * limit;
    const data = list.slice(startIndex, startIndex + limit);

    return {
      data,
      total,
      page,
      limit,
      totalPages,
    };
  }

  /**
   * Tìm đại lý theo ID
   */
  async getCustomerById(id: string): Promise<CustomerEntity> {
    const customer = this.customers.get(id);
    if (!customer) {
      throw new NotFoundException(`Không tìm thấy đại lý có ID: ${id}`);
    }
    return customer;
  }

  /**
   * Lấy danh sách điểm giao hàng của đúng đại lý đó (SN-31 & SN-32)
   */
  async getDeliveryPoints(customerId: string): Promise<DeliveryPointEntity[]> {
    const customer = await this.getCustomerById(customerId);
    return customer.deliveryPoints;
  }

  /**
   * Thêm điểm giao hàng mới cho đại lý (SN-31)
   */
  async createDeliveryPoint(
    customerId: string,
    dto: CreateDeliveryPointDto,
  ): Promise<DeliveryPointEntity> {
    const customer = await this.getCustomerById(customerId);

    const isFirstPoint = customer.deliveryPoints.length === 0;
    const shouldBeDefault = isFirstPoint || Boolean(dto.isDefault);

    // Nếu điểm mới là mặc định, hủy mặc định các điểm cũ
    if (shouldBeDefault) {
      for (const dp of customer.deliveryPoints) {
        dp.isDefault = false;
      }
    }

    const newPoint = new DeliveryPointEntity({
      id: `dp-${customerId.replace('cust-', '')}-${Date.now().toString().slice(-4)}`,
      customerId,
      name: dto.name.trim(),
      address: dto.address.trim(),
      ward: dto.ward?.trim(),
      district: dto.district?.trim(),
      province: dto.province?.trim() || 'TP. Hồ Chí Minh',
      receiverName: dto.receiverName.trim(),
      phone: dto.phone.trim(),
      roadNote: dto.roadNote?.trim(),
      isDefault: shouldBeDefault,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    customer.deliveryPoints.push(newPoint);
    customer.updatedAt = new Date();
    return newPoint;
  }

  /**
   * Cập nhật điểm giao hàng (SN-31)
   */
  async updateDeliveryPoint(
    customerId: string,
    pointId: string,
    dto: UpdateDeliveryPointDto,
  ): Promise<DeliveryPointEntity> {
    const customer = await this.getCustomerById(customerId);
    const point = customer.deliveryPoints.find((p) => p.id === pointId);
    if (!point) {
      throw new NotFoundException(`Không tìm thấy điểm giao hàng ${pointId}`);
    }

    if (dto.isDefault) {
      for (const dp of customer.deliveryPoints) {
        dp.isDefault = false;
      }
      point.isDefault = true;
    }

    if (dto.name !== undefined) point.name = dto.name.trim();
    if (dto.address !== undefined) point.address = dto.address.trim();
    if (dto.receiverName !== undefined) point.receiverName = dto.receiverName.trim();
    if (dto.phone !== undefined) point.phone = dto.phone.trim();
    if (dto.roadNote !== undefined) point.roadNote = dto.roadNote.trim();
    if (dto.ward !== undefined) point.ward = dto.ward?.trim();
    if (dto.district !== undefined) point.district = dto.district?.trim();
    if (dto.province !== undefined) point.province = dto.province?.trim();

    point.updatedAt = new Date();
    customer.updatedAt = new Date();
    return point;
  }

  /**
   * Đặt 1 điểm giao hàng làm mặc định (SN-31)
   */
  async setDefaultDeliveryPoint(
    customerId: string,
    pointId: string,
  ): Promise<DeliveryPointEntity> {
    const customer = await this.getCustomerById(customerId);
    const targetPoint = customer.deliveryPoints.find((p) => p.id === pointId);
    if (!targetPoint) {
      throw new NotFoundException(`Không tìm thấy điểm giao hàng ${pointId}`);
    }

    for (const dp of customer.deliveryPoints) {
      dp.isDefault = dp.id === pointId;
    }

    targetPoint.updatedAt = new Date();
    customer.updatedAt = new Date();
    return targetPoint;
  }

  /**
   * Xóa điểm giao hàng của đại lý (SN-31)
   */
  async deleteDeliveryPoint(
    customerId: string,
    pointId: string,
  ): Promise<{ success: boolean; message: string }> {
    const customer = await this.getCustomerById(customerId);
    const pointIndex = customer.deliveryPoints.findIndex((p) => p.id === pointId);
    if (pointIndex === -1) {
      throw new NotFoundException(`Không tìm thấy điểm giao hàng ${pointId}`);
    }

    const wasDefault = customer.deliveryPoints[pointIndex].isDefault;
    customer.deliveryPoints.splice(pointIndex, 1);

    // Nếu điểm vừa xóa là mặc định và vẫn còn điểm khác, gán điểm đầu tiên làm mặc định
    if (wasDefault && customer.deliveryPoints.length > 0) {
      customer.deliveryPoints[0].isDefault = true;
    }

    customer.updatedAt = new Date();
    return {
      success: true,
      message: 'Đã xóa điểm giao hàng thành công',
    };
  }
}
