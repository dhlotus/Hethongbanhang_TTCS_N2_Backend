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
import { LockCustomerDto } from './dto/lock-customer.dto';
import { FilterCustomersDto } from './dto/filter-customers.dto';
import { PaginatedCustomersResult } from './interfaces/paginated-customers.interface';
import { UserRole } from '../../common/enums/user-role.enum';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { INITIAL_AGENCIES } from './agencies.seed';
import { CustomerDebtStatusDto } from './dto/customer-debt-status.dto';
import { CustomerAssignmentHistoryEntity } from './entities/customer-assignment-history.entity';
import { AssignSalesRepDto } from './dto/assign-sales-rep.dto';
import { BulkTransferTerritoryDto } from './dto/bulk-transfer-territory.dto';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { QueryAssignmentHistoryDto } from './dto/query-assignment-history.dto';
import { QueryCustomersDto } from './dto/query-customers.dto';
import { matchesSearchTerm, removeVietnameseTones } from '../../common/utils/vietnamese.util';

/**
 * Service Quản lý Đại lý & Điểm giao hàng (SN-31, SN-32 & SN-35)
 */
@Injectable()
export class CustomersService implements OnModuleInit {
  private readonly customers = new Map<string, CustomerEntity>();
  private assignmentHistories: CustomerAssignmentHistoryEntity[] = [];

  constructor(@Optional() private readonly dbService?: DatabaseService) {
    this.seedInitialCustomers();
  }

  async onModuleInit(): Promise<void> {
    if (this.customers.size === 0) {
      this.seedInitialCustomers();
    }
  }

  /**
   * Đặt lại dữ liệu phục vụ test (SN-35)
   */
  resetData(): void {
    this.customers.clear();
    this.assignmentHistories = [];
    this.seedInitialCustomers();
  }

  /**
   * Khởi tạo dữ liệu mẫu thực tế 100% cho các đại lý và nhiều điểm giao hàng (SN-31 & SN-35)
   */
  private seedInitialCustomers(): void {
    for (const c of INITIAL_AGENCIES) {
      this.customers.set(c.id, new CustomerEntity(c));
    }

    const sn35Seeds: CustomerEntity[] = [
      new CustomerEntity({
        id: 'cust-hn-001',
        code: 'DL-HN-001',
        name: 'Đại Lý Thực Phẩm Sạch Thăng Long',
        taxCode: '0109876541',
        customerGroup: 'AGENT_LEVEL_1',
        region: 'Miền Bắc',
        salesRepId: 'usr-sales-002',
        salesRepName: 'Trần Văn Nam',
        creditLimit: 300000000,
        currentDebt: 45000000,
        maxDebtDays: 30,
        phone: '0981234561',
        email: 'thanglong.hn@lohasales.vn',
        address: '102 Cầu Giấy, Q. Cầu Giấy, Hà Nội',
        status: CustomerStatus.ACTIVE,
      }),
      new CustomerEntity({
        id: 'cust-hn-002',
        code: 'DL-HN-002',
        name: 'Bách Hóa Tổng Hợp Hà Đông',
        taxCode: '0109876542',
        customerGroup: 'AGENT_LEVEL_2',
        region: 'Miền Bắc',
        salesRepId: 'usr-sales-002',
        salesRepName: 'Trần Văn Nam',
        creditLimit: 150000000,
        currentDebt: 12000000,
        maxDebtDays: 30,
        phone: '0981234562',
        email: 'hadong.mart@lohasales.vn',
        address: '45 Quang Trung, Q. Hà Đông, Hà Nội',
        status: CustomerStatus.ACTIVE,
      }),
      new CustomerEntity({
        id: 'cust-hp-001',
        code: 'DL-HP-001',
        name: 'Đại Lý Cảng Hải Phòng Mart',
        taxCode: '0208765431',
        customerGroup: 'AGENT_LEVEL_2',
        region: 'Miền Bắc',
        salesRepId: undefined,
        salesRepName: undefined,
        creditLimit: 100000000,
        currentDebt: 0,
        maxDebtDays: 30,
        phone: '0931234561',
        email: 'haiphong.cang@lohasales.vn',
        address: '88 Lê Hồng Phong, TP. Hải Phòng',
        status: CustomerStatus.ACTIVE,
      }),
      new CustomerEntity({
        id: 'cust-qn-001',
        code: 'DL-QN-001',
        name: 'Siêu Thị Tiêu Dùng Hạ Long',
        taxCode: '1401234561',
        customerGroup: 'AGENT_LEVEL_2',
        region: 'Miền Bắc',
        salesRepId: undefined,
        salesRepName: undefined,
        creditLimit: 80000000,
        currentDebt: 0,
        maxDebtDays: 30,
        phone: '0931234562',
        email: 'halong.store@lohasales.vn',
        address: '12 Lê Thánh Tông, TP. Hạ Long, Quảng Ninh',
        status: CustomerStatus.ACTIVE,
      }),
      new CustomerEntity({
        id: 'cust-dn-001',
        code: 'DL-DN-001',
        name: 'Đại Lý Phân Phối Đà Nẵng Xanh',
        taxCode: '0401234561',
        customerGroup: 'AGENT_LEVEL_1',
        region: 'Miền Trung',
        salesRepId: undefined,
        salesRepName: undefined,
        creditLimit: 200000000,
        currentDebt: 0,
        maxDebtDays: 30,
        phone: '0941234561',
        email: 'danang.green@lohasales.vn',
        address: '56 Nguyễn Văn Linh, Q. Hải Châu, TP. Đà Nẵng',
        status: CustomerStatus.ACTIVE,
      }),
      new CustomerEntity({
        id: 'cust-hue-001',
        code: 'DL-HUE-001',
        name: 'Cửa Hàng Thực Dưỡng Cố Đô Huế',
        taxCode: '3301234561',
        customerGroup: 'AGENT_LEVEL_2',
        region: 'Miền Trung',
        salesRepId: undefined,
        salesRepName: undefined,
        creditLimit: 60000000,
        currentDebt: 0,
        maxDebtDays: 30,
        phone: '0941234562',
        email: 'codo.hue@lohasales.vn',
        address: '20 Hùng Vương, TP. Huế',
        status: CustomerStatus.ACTIVE,
      }),
    ];

    for (const c of sn35Seeds) {
      this.customers.set(c.id, c);
    }
    this.unusedLegacy();
  }

  private unusedLegacy(): void {
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
        currentDebt: 52000000,
        maxDebtDays: 20,
        overdueAmount: 0,
        overdueDays: 0,
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
        currentDebt: 45000000,
        maxDebtDays: 30,
        overdueAmount: 18000000,
        overdueDays: 45,
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

    if (query?.search && query.search.trim()) {
      const q = query.search.trim();
      result = result.filter(
        (c) =>
          matchesSearchTerm(c.name, q) ||
          matchesSearchTerm(c.code, q) ||
          matchesSearchTerm(c.phone, q),
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
   * - Tìm kiếm nhanh (search): Hỗ trợ cả tiếng Việt CÓ DẤU và KHÔNG DẤU theo Mã (code), Tên (name), Số điện thoại (phone), Địa chỉ (address), MST (taxCode)
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
          return c.salesRepId === currentUser.userId || c.salesRep?.id === currentUser.userId;
        });
      }
    }

    // 2. Lọc theo nhân viên phụ trách chỉ định (dành cho Admin / Quản lý)
    if (query?.salesRepId && query.salesRepId !== 'ALL') {
      const targetRepId = query.salesRepId;
      list = list.filter((c) => {
        return c.salesRepId === targetRepId || c.salesRep?.id === targetRepId;
      });
    }

    // 3. Tìm kiếm nhanh (Full-text/Partial search) theo code, name, phone, address, taxCode (hỗ trợ cả có dấu và không dấu)
    if (query?.search && query.search.trim()) {
      const q = query.search.trim();
      list = list.filter(
        (c) =>
          matchesSearchTerm(c.code, q) ||
          matchesSearchTerm(c.name, q) ||
          matchesSearchTerm(c.phone, q) ||
          matchesSearchTerm(c.address, q) ||
          matchesSearchTerm(c.taxCode, q),
      );
    }

    // 4. Lọc theo Khu vực / Địa bàn kinh doanh (hỗ trợ cả tiếng Việt và alias)
    if (query?.region && query.region !== 'ALL') {
      const reg = query.region.toLowerCase().trim();
      const normReg = removeVietnameseTones(reg);
      list = list.filter((c) => {
        if (!c.region) return false;
        const cReg = c.region.toLowerCase().trim();
        const normCReg = removeVietnameseTones(cReg);
        if (cReg === reg || normCReg === normReg) return true;
        if (reg === 'south' && (normCReg.includes('nam') || normCReg === 'mien nam')) return true;
        if (reg === 'central' && (normCReg.includes('trung') || normCReg === 'mien trung')) return true;
        if (reg === 'north' && (normCReg.includes('bac') || normCReg === 'mien bac')) return true;
        return false;
      });
    }

    // 5. Lọc theo Phân nhóm khách hàng
    if (query?.customerGroup && query.customerGroup !== 'ALL') {
      const grp = query.customerGroup.toUpperCase().trim();
      list = list.filter((c) => c.customerGroup && c.customerGroup.toUpperCase().trim() === grp);
    }

    // 6. Lọc theo Trạng thái hoạt động
    if (query?.status && (query.status as string) !== 'ALL') {
      const st = (query.status as string).toUpperCase().trim();
      list = list.filter((c) => c.status && c.status.toUpperCase().trim() === st);
    }

    // 7. Phân trang kết quả
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(query?.limit) || 20));
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
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

  /**
  /**
   * Khóa giao dịch với một đại lý kèm lý do bắt buộc (SN-36)
   */
  async lockCustomer(
    id: string,
    dto: LockCustomerDto,
    currentUser?: { userId?: string; fullName?: string },
  ): Promise<CustomerEntity> {
    if (!dto.reason || dto.reason.trim() === '') {
      throw new BadRequestException('Bắt buộc phải nhập lý do khi khóa đại lý');
    }

    const customer = await this.getCustomerById(id);
    customer.status = CustomerStatus.LOCKED;
    customer.lockReason = dto.reason.trim();
    customer.lockedAt = new Date();
    customer.lockedBy = currentUser?.fullName || currentUser?.userId || 'Hệ thống';
    customer.updatedAt = new Date();

    if (this.dbService?.isConnected()) {
      try {
        await this.dbService.query(
          `UPDATE customers 
           SET status = $1, lock_reason = $2, updated_at = NOW() 
           WHERE id = $3 OR code = $3;`,
          [CustomerStatus.LOCKED, customer.lockReason, id],
        );
      } catch {
        // Fallback in-memory
      }
    }

    return customer;
  }

  /**
   * Cập nhật hạn mức công nợ cho đại lý (SN-34)
   */
  async updateCustomerCredit(
    customerId: string,
    data: {
      creditLimit?: number;
      maxDebtDays?: number;
      paymentTerms?: string;
    },
  ): Promise<CustomerEntity> {
    const customer = await this.getCustomerById(customerId);

    if (data.creditLimit !== undefined) {
      customer.creditLimit = data.creditLimit;
    }
    if (data.maxDebtDays !== undefined) {
      customer.maxDebtDays = data.maxDebtDays;
    }

    customer.updatedAt = new Date();

    if (this.dbService?.isConnected()) {
      try {
        await this.dbService.query(
          `UPDATE customers 
           SET credit_limit = $1, max_debt_days = $2, payment_terms = $3, updated_at = NOW() 
           WHERE id = $4 OR code = $4;`,
          [customer.creditLimit, customer.maxDebtDays, data.paymentTerms || 'NET_30', customerId],
        );
      } catch {
        // Fallback in-memory
      }
    }

    return customer;
  }

  /**
   * Mở khóa giao dịch với đại lý (SN-36)
   */
  async unlockCustomer(id: string): Promise<CustomerEntity> {
    const customer = await this.getCustomerById(id);
    customer.status = CustomerStatus.ACTIVE;
    customer.lockReason = undefined;
    customer.lockedAt = undefined;
    customer.lockedBy = undefined;
    customer.updatedAt = new Date();

    if (this.dbService?.isConnected()) {
      try {
        await this.dbService.query(
          `UPDATE customers 
           SET status = $1, lock_reason = NULL, updated_at = NOW() 
           WHERE id = $2 OR code = $2;`,
          [CustomerStatus.ACTIVE, id],
        );
      } catch {
        // Fallback in-memory
      }
    }

    return customer;
  }

  /**
   * Cập nhật trạng thái tín dụng / khóa đại lý (SN-34)
   */
  async updateCustomerStatus(
    customerId: string,
    status: CustomerStatus,
    lockReason?: string,
  ): Promise<CustomerEntity> {
    const customer = await this.getCustomerById(customerId);
    customer.status = status;
    customer.updatedAt = new Date();

    if (this.dbService?.isConnected()) {
      try {
        await this.dbService.query(
          `UPDATE customers 
           SET status = $1, lock_reason = $2, updated_at = NOW() 
           WHERE id = $3 OR code = $3;`,
          [status, lockReason || null, customerId],
        );
      } catch {
        // Fallback in-memory
      }
    }

    return customer;
  }

  /**
   * Kiểm tra thông tin & trạng thái công nợ của đại lý (Task SN-41)
   */
  async getCustomerDebtStatus(customerId: string): Promise<CustomerDebtStatusDto> {
    const customer = await this.getCustomerById(customerId);
    const creditLimit = customer.creditLimit || 0;
    const currentDebt = customer.currentDebt || 0;
    const maxDebtDays = customer.maxDebtDays || 30;
    const overdueAmount = customer.overdueAmount || 0;
    const overdueDays = customer.overdueDays || 0;
    const availableLimit = Math.max(0, creditLimit - currentDebt);

    // Kiểm tra chặn cứng (Hard Block - Trường hợp 1):
    // Quá hạn vượt quá số ngày cho phép (overdueDays > maxDebtDays) và có số tiền nợ quá hạn > 0
    let canCreateOrder = true;
    let blockReason: string | undefined;
    let warningMessage: string | undefined;

    if (customer.status === CustomerStatus.LOCKED) {
      canCreateOrder = false;
      blockReason = `Tài khoản đại lý [${customer.name}] đang trong trạng thái bị khóa. Không thể tạo đơn hàng mới.`;
    } else if (overdueDays > maxDebtDays && overdueAmount > 0) {
      canCreateOrder = false;
      blockReason = `Đại lý đang có khoản nợ quá hạn ${overdueDays} ngày (vượt quá ${maxDebtDays} ngày cho phép) với số tiền ${overdueAmount.toLocaleString('vi-VN')} đ. Hệ thống tạm khóa quyền tạo đơn hàng mới cho đại lý này.`;
    } else if (overdueAmount > 0) {
      warningMessage = `Đại lý đang có khoản nợ quá hạn ${overdueDays}/${maxDebtDays} ngày (${overdueAmount.toLocaleString('vi-VN')} đ). Vui lòng lưu ý đôn đốc thanh toán.`;
    } else if (currentDebt >= creditLimit) {
      warningMessage = `Đại lý đã sử dụng hết hạn mức công nợ được cấp (${creditLimit.toLocaleString('vi-VN')} đ). Đơn hàng mới sẽ được chuyển sang trạng thái chờ phê duyệt.`;
    } else if (availableLimit < creditLimit * 0.2) {
      warningMessage = `Hạn mức công nợ khả dụng của đại lý chỉ còn ${availableLimit.toLocaleString('vi-VN')} đ (dưới 20%). Lưu ý kiểm tra giá trị đơn hàng.`;
    }

    return {
      customerId: customer.id,
      customerCode: customer.code,
      customerName: customer.name,
      creditLimit,
      currentDebt,
      availableLimit,
      maxDebtDays,
      overdueAmount,
      overdueDays,
      canCreateOrder,
      blockReason,
      warningMessage,
    };
  }

  /**
   * Alias tìm đại lý theo ID (SN-35)
   */
  async findById(id: string): Promise<CustomerEntity> {
    return this.getCustomerById(id);
  }

  /**
   * Alias tìm kiếm & lọc danh sách đại lý (SN-35)
   */
  async findAll(query?: any, currentUser?: ICurrentUser): Promise<any> {
    const res = await this.filterCustomers(query, currentUser);
    const unassignedCount = Array.from(this.customers.values()).filter(
      (c) => !c.salesRepId || c.salesRepId === '',
    ).length;
    return {
      ...res,
      unassignedCount,
    };
  }

  /**
   * Gán nhân viên kinh doanh phụ trách chính cho đại lý (SN-35)
   */
  async assignSalesRep(
    customerId: string,
    dto: AssignSalesRepDto,
    currentUser?: ICurrentUser,
  ): Promise<CustomerEntity> {
    const customer = await this.getCustomerById(customerId);
    if (!customer) {
      throw new NotFoundException(`Không tìm thấy đại lý có mã hoặc ID [${customerId}]`);
    }

    const fromSalesRepId = customer.salesRepId || null;
    const fromSalesRepName = customer.salesRepName || null;

    let toSalesRepName = 'Trần Văn Nam';
    if (dto.salesRepId === 'usr-salesmgr-003') toSalesRepName = 'Lê Quản Lý (Sales Manager)';
    else if (dto.salesRepId === 'usr-sales-002') toSalesRepName = 'Trần Văn Nam';
    else if (dto.salesRepId === 'usr-sale-01') toSalesRepName = 'Trần Văn Long';
    else if (dto.salesRepId === 'usr-sale-02') toSalesRepName = 'Lê Thị Thu Thảo';

    customer.salesRepId = dto.salesRepId;
    customer.salesRepName = toSalesRepName;
    customer.salesRep = { id: dto.salesRepId, name: toSalesRepName };
    customer.updatedAt = new Date();

    const history = new CustomerAssignmentHistoryEntity({
      id: `hist-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      transferBatchId: `BATCH-${Date.now()}`,
      customerId: customer.id,
      customerCode: customer.code,
      customerName: customer.name,
      region: customer.region || 'Miền Bắc',
      fromSalesRepId,
      fromSalesRepName,
      toSalesRepId: dto.salesRepId,
      toSalesRepName,
      performedById: currentUser?.userId || 'usr-salesmgr-003',
      performedByName: currentUser?.username || 'Quản lý kinh doanh',
      reason: dto.reason || 'Phân công nhân viên kinh doanh phụ trách',
      notes: dto.notes,
      createdAt: new Date(),
    });

    this.assignmentHistories.unshift(history);
    return customer;
  }

  /**
   * Chuyển giao địa bàn hàng loạt khi nhân viên nghỉ việc (SN-35)
   */
  async bulkTransferTerritory(
    dto: BulkTransferTerritoryDto,
    currentUser?: ICurrentUser,
  ): Promise<any> {
    if (dto.fromSalesRepId === dto.toSalesRepId) {
      throw new BadRequestException('Nhân sự bàn giao và tiếp nhận không được trùng nhau');
    }
    if (!dto.reason || !dto.reason.trim()) {
      throw new BadRequestException('Bắt buộc phải nhập lý do chuyển giao địa bàn');
    }

    let toSalesRepName = 'Lê Quản Lý (Sales Manager)';
    if (dto.toSalesRepId === 'usr-sales-002') toSalesRepName = 'Trần Văn Nam';
    else if (dto.toSalesRepId === 'usr-salesmgr-003') toSalesRepName = 'Lê Quản Lý (Sales Manager)';
    else if (dto.toSalesRepId === 'usr-sale-01') toSalesRepName = 'Trần Văn Long';
    else if (dto.toSalesRepId === 'usr-sale-02') toSalesRepName = 'Lê Thị Thu Thảo';

    let fromSalesRepName = 'Trần Văn Nam';
    if (dto.fromSalesRepId === 'usr-sales-002') fromSalesRepName = 'Trần Văn Nam';
    else if (dto.fromSalesRepId === 'usr-sale-01') fromSalesRepName = 'Trần Văn Long';
    else if (dto.fromSalesRepId === 'usr-sale-02') fromSalesRepName = 'Lê Thị Thu Thảo';
    else if (dto.fromSalesRepId === 'usr-salesmgr-003') fromSalesRepName = 'Lê Quản Lý (Sales Manager)';

    let targets = Array.from(this.customers.values()).filter(
      (c) => c.salesRepId === dto.fromSalesRepId || (c.salesRep && c.salesRep.id === dto.fromSalesRepId),
    );

    if (dto.customerIds && dto.customerIds.length > 0) {
      const set = new Set(dto.customerIds);
      targets = targets.filter((c) => set.has(c.id) || set.has(c.code));
    }

    const batchId = `BATCH-${Date.now()}`;
    const transferred: CustomerEntity[] = [];

    for (const c of targets) {
      const oldId = c.salesRepId || dto.fromSalesRepId;
      const oldName = c.salesRepName || fromSalesRepName;

      c.salesRepId = dto.toSalesRepId;
      c.salesRepName = toSalesRepName;
      c.salesRep = { id: dto.toSalesRepId, name: toSalesRepName };
      c.updatedAt = new Date();

      const hist = new CustomerAssignmentHistoryEntity({
        id: `hist-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        transferBatchId: batchId,
        customerId: c.id,
        customerCode: c.code,
        customerName: c.name,
        region: c.region || 'Miền Bắc',
        fromSalesRepId: oldId,
        fromSalesRepName: oldName,
        toSalesRepId: dto.toSalesRepId,
        toSalesRepName,
        performedById: currentUser?.userId || 'usr-salesmgr-003',
        performedByName: currentUser?.username || 'Quản lý kinh doanh',
        reason: dto.reason.trim(),
        notes: dto.notes,
        createdAt: new Date(),
      });
      this.assignmentHistories.unshift(hist);
      transferred.push(c);
    }

    return {
      message: `Chuyển giao thành công ${transferred.length} đại lý`,
      transferBatchId: batchId,
      transferredCount: transferred.length,
      fromSalesRep: { id: dto.fromSalesRepId, name: fromSalesRepName },
      toSalesRep: { id: dto.toSalesRepId, name: toSalesRepName },
      transferredCustomers: transferred.map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        region: c.region,
      })),
    };
  }

  /**
   * Lấy lịch sử chuyển giao & phân công địa bàn (SN-35)
   */
  async getAssignmentHistory(query?: QueryAssignmentHistoryDto): Promise<any> {
    let list = [...this.assignmentHistories];
    if (query?.customerId) {
      list = list.filter((h) => h.customerId === query.customerId);
    }
    if (query?.fromSalesRepId) {
      list = list.filter((h) => h.fromSalesRepId === query.fromSalesRepId);
    }
    if (query?.toSalesRepId) {
      list = list.filter((h) => h.toSalesRepId === query.toSalesRepId);
    }
    if (query?.transferBatchId) {
      list = list.filter((h) => h.transferBatchId === query.transferBatchId);
    }

    const page = Number(query?.page) || 1;
    const limit = Number(query?.limit) || 20;
    const startIndex = (page - 1) * limit;
    const pagedData = list.slice(startIndex, startIndex + limit);

    return {
      data: pagedData,
      total: list.length,
      page,
      limit,
      totalPages: Math.ceil(list.length / limit) || 1,
    };
  }

  /**
   * Tạo đại lý mới (SN-30 & SN-35)
   * - Khai báo: mã đại lý, tên, mã số thuế, nhóm khách hàng, khu vực, người phụ trách, trạng thái (SN-30 AC1)
   * - Mã đại lý là duy nhất (SN-30 AC2)
   */
  async createCustomer(dto: CreateCustomerDto): Promise<CustomerEntity> {
    const trimmedCode = dto.code?.trim();
    if (!trimmedCode) {
      throw new BadRequestException('Mã đại lý không được để trống.');
    }

    // Kiểm tra tính duy nhất của mã đại lý (không phân biệt hoa/thường)
    const normalizedCode = trimmedCode.toUpperCase();
    const existingCustomer = Array.from(this.customers.values()).find(
      (c) => c.code && c.code.trim().toUpperCase() === normalizedCode,
    );
    if (existingCustomer) {
      throw new BadRequestException(
        `Mã đại lý "${trimmedCode}" đã tồn tại trong hệ thống. Vui lòng nhập mã khác.`,
      );
    }

    const newId = `cust-${Date.now()}`;
    let salesRepName: string | undefined = dto.salesRepName;
    if (!salesRepName && dto.salesRepId) {
      if (dto.salesRepId === 'usr-sales-002') salesRepName = 'Trần Văn Nam';
      else if (dto.salesRepId === 'usr-sale-01') salesRepName = 'Trần Văn Long';
      else if (dto.salesRepId === 'usr-sale-02') salesRepName = 'Nguyễn Thị Hằng';
      else if (dto.salesRepId === 'usr-sale-03') salesRepName = 'Phạm Minh Tuấn';
    }

    const deliveryPoints: DeliveryPointEntity[] = [];
    if (dto.deliveryPointName?.trim()) {
      deliveryPoints.push(
        new DeliveryPointEntity({
          id: `dp-${newId.replace('cust-', '')}-1`,
          customerId: newId,
          name: dto.deliveryPointName.trim(),
          address: dto.address?.trim() || 'Trụ sở chính',
          receiverName: dto.receiverName?.trim() || dto.name.trim(),
          phone: dto.phone.trim(),
          isDefault: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );
    }

    const newCustomer = new CustomerEntity({
      id: newId,
      code: trimmedCode,
      name: dto.name.trim(),
      region: dto.region?.trim() || 'Miền Nam',
      customerGroup: dto.customerGroup || 'AGENT_LEVEL_2',
      taxCode: dto.taxCode?.trim(),
      salesRepId: dto.salesRepId,
      salesRepName,
      salesRep: dto.salesRepId
        ? { id: dto.salesRepId, name: salesRepName || '' }
        : undefined,
      phone: dto.phone.trim(),
      email: dto.email?.trim(),
      address: dto.address?.trim(),
      creditLimit: dto.creditLimit ?? 0,
      currentDebt: 0,
      maxDebtDays: dto.maxDebtDays ?? 30,
      status: CustomerStatus.ACTIVE,
      deliveryPoints,
    });

    this.customers.set(newId, newCustomer);
    return newCustomer;
  }

  /**
   * Xóa hồ sơ đại lý (SN-30 AC4)
   * Chặn xóa nếu đại lý đã phát sinh giao dịch hoặc còn công nợ, chỉ cho phép chuyển sang trạng thái Ngừng giao dịch (INACTIVE).
   */
  async deleteCustomer(
    id: string,
    hasTransactions = false,
  ): Promise<{ success: boolean; message: string; customerId: string }> {
    const customer = await this.getCustomerById(id);

    const hasDebt = (customer.currentDebt || 0) > 0;
    const isTransacted = hasDebt || hasTransactions;

    if (isTransacted) {
      throw new BadRequestException(
        `Đại lý "${customer.name}" (${customer.code}) đã phát sinh giao dịch hoặc còn công nợ (${(customer.currentDebt || 0).toLocaleString('vi-VN')} đ), không thể xóa. Chỉ được phép chuyển sang trạng thái Ngừng giao dịch (INACTIVE).`,
      );
    }

    this.customers.delete(customer.id);

    if (this.dbService?.isConnected()) {
      try {
        await this.dbService.query(`DELETE FROM customers WHERE id = $1 OR code = $1;`, [id]);
      } catch {
        // Fallback in-memory
      }
    }

    return {
      success: true,
      message: `Đã xóa hồ sơ đại lý "${customer.name}" (${customer.code}) thành công.`,
      customerId: customer.id,
    };
  }

  /**
   * Ngừng giao dịch với đại lý (SN-30 AC4: Chuyển sang trạng thái INACTIVE)
   */
  async deactivateCustomer(id: string): Promise<CustomerEntity> {
    const customer = await this.getCustomerById(id);
    customer.status = CustomerStatus.INACTIVE;
    customer.updatedAt = new Date();

    if (this.dbService?.isConnected()) {
      try {
        await this.dbService.query(
          `UPDATE customers SET status = $1, updated_at = NOW() WHERE id = $2 OR code = $2;`,
          [CustomerStatus.INACTIVE, id],
        );
      } catch {
        // Fallback in-memory
      }
    }

    return customer;
  }
}


