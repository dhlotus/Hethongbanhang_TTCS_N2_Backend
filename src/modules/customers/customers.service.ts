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
    ];

    for (const c of list) {
      this.customers.set(c.id, c);
    }
  }

  /**
   * Lấy danh sách tất cả đại lý kèm lọc (SN-38)
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
    if (data.paymentTerms !== undefined) {
      // customer.paymentTerms = data.paymentTerms;
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
}

