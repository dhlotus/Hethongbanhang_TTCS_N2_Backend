import { BadRequestException, NotFoundException } from "@nestjs/common";
import { AgencyService } from "./agency.service";
import { AgencyStatus } from "./enums/agency-status.enum";
import { CreateAgencyDto, UpdateAgencyDto } from "./dto";

describe("AgencyService (JIRA SN-30: Quản lý hồ sơ đại lý)", () => {
  let service: AgencyService;

  beforeEach(() => {
    service = new AgencyService();
  });

  describe("1. Khởi tạo & Dữ liệu mẫu (Read / Seed)", () => {
    it("phải có sẵn danh sách đại lý mẫu với đầy đủ các trường theo nghiệp vụ", async () => {
      const agencies = await service.findAllAgencies();
      expect(agencies.length).toBeGreaterThanOrEqual(5);

      const first = agencies[0];
      expect(first.id).toBeDefined();
      expect(first.agencyCode).toBeDefined();
      expect(first.name).toBeDefined();
      expect(first.taxCode).toBeDefined();
      expect(first.customerGroupId).toBeDefined();
      expect(first.region).toBeDefined();
      expect(first.assignedUser).toBeDefined();
      expect(first.status).toBeDefined();
    });

    it("tìm kiếm theo ID hoặc Mã đại lý chính xác", async () => {
      const agency = await service.getAgencyById("cust-dl-0001");
      expect(agency.agencyCode).toBe("DL-0001");
      expect(agency.customerGroupId).toBe("AGENT_LEVEL_1");

      const byCode = await service.getAgencyById("DL-0002");
      expect(byCode.id).toBe("cust-dl-0002");
    });

    it("ném NotFoundException nếu đại lý không tồn tại", async () => {
      await expect(service.getAgencyById("NON_EXISTING_ID")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("hỗ trợ tìm kiếm theo từ khóa (mã, tên, MST, SĐT)", async () => {
      const searchByName = await service.findAllAgencies({
        search: "Minh Khang",
      });
      expect(searchByName.some((a) => a.agencyCode === "DL-0001")).toBe(true);

      const searchByCode = await service.findAllAgencies({ search: "DL-0002" });
      expect(searchByCode.length).toBe(1);
      expect(searchByCode[0].agencyCode).toBe("DL-0002");

      const searchByTax = await service.findAllAgencies({
        search: "0316789001",
      });
      expect(searchByTax.length).toBe(1);
      expect(searchByTax[0].agencyCode).toBe("DL-0001");
    });

    it("lọc đại lý theo nhóm khách hàng (quyết định bảng giá) và khu vực", async () => {
      const level1List = await service.findAllAgencies({
        customerGroupId: "AGENT_LEVEL_1",
      });
      expect(
        level1List.every((a) => a.customerGroupId === "AGENT_LEVEL_1"),
      ).toBe(true);

      const northList = await service.findAllAgencies({
        region: "Miền Bắc",
      });
      expect(northList.every((a) => a.region === "Miền Bắc")).toBe(true);
      expect(northList.some((a) => a.agencyCode === "DL-0005")).toBe(true);
    });

    it("phân trang danh sách đại lý hoạt động đúng", async () => {
      const paginated = await service.findAllPaginated({ page: 1, limit: 2 });
      expect(paginated.data.length).toBe(2);
      expect(paginated.total).toBeGreaterThanOrEqual(5);
      expect(paginated.page).toBe(1);
      expect(paginated.limit).toBe(2);
      expect(paginated.totalPages).toBeGreaterThanOrEqual(3);
    });
  });

  describe("2. Tạo mới đại lý & Kiểm tra trùng mã (Create)", () => {
    it("tạo đại lý mới thành công với đầy đủ các trường", async () => {
      const dto: CreateAgencyDto = {
        agencyCode: "DL-NEW-01",
        name: "Đại Lý Phân Phối Nước Giải Khát Tân Bình",
        taxCode: "0319998877",
        customerGroupId: "AGENT_LEVEL_1",
        region: "Miền Nam",
        assignedUser: "Trần Văn Long",
        status: AgencyStatus.ACTIVE,
        phone: "0909112233",
        email: "tanbinh.dist@gmail.com",
        address: "100 Cộng Hòa, P.4, Q.Tân Bình, TP.HCM",
      };

      const created = await service.createAgency(dto);
      expect(created.id).toBeDefined();
      expect(created.agencyCode).toBe("DL-NEW-01");
      expect(created.name).toBe(dto.name);
      expect(created.taxCode).toBe(dto.taxCode);
      expect(created.customerGroupId).toBe(dto.customerGroupId);
      expect(created.region).toBe(dto.region);
      expect(created.assignedUser).toBe(dto.assignedUser);
      expect(created.status).toBe(AgencyStatus.ACTIVE);

      const fetched = await service.getAgencyById(created.id);
      expect(fetched.agencyCode).toBe("DL-NEW-01");
    });

    it("ném BadRequestException khi tạo đại lý trùng agencyCode (Mã đại lý là duy nhất)", async () => {
      const duplicateDto: CreateAgencyDto = {
        agencyCode: "DL-0001", // Đã tồn tại trong seed
        name: "Doanh Nghiệp Trùng Mã",
        customerGroupId: "AGENT_LEVEL_2",
      };

      await expect(service.createAgency(duplicateDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("kiểm tra trùng mã không phân biệt hoa thường (case-insensitive)", async () => {
      const duplicateDtoLower: CreateAgencyDto = {
        agencyCode: "dl-0001",
        name: "Doanh Nghiệp Trùng Mã Chữ Thường",
        customerGroupId: "AGENT_LEVEL_2",
      };

      await expect(service.createAgency(duplicateDtoLower)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe("3. Cập nhật thông tin đại lý (Update)", () => {
    it("cập nhật thông tin đại lý thành công", async () => {
      const updateDto: UpdateAgencyDto = {
        name: "Công Ty TNHH Thương Mại Minh Khang Cập Nhật",
        taxCode: "0316789999",
        region: "Miền Trung",
        assignedUser: "Nguyễn Thị Hằng",
        phone: "0988776655",
      };

      const updated = await service.updateAgency("cust-dl-0001", updateDto);
      expect(updated.name).toBe("Công Ty TNHH Thương Mại Minh Khang Cập Nhật");
      expect(updated.taxCode).toBe("0316789999");
      expect(updated.region).toBe("Miền Trung");
      expect(updated.assignedUser).toBe("Nguyễn Thị Hằng");
      expect(updated.phone).toBe("0988776655");
    });

    it("ném BadRequestException khi đổi agencyCode trùng với đại lý khác", async () => {
      const updateDto: UpdateAgencyDto = {
        agencyCode: "DL-0002", // Trùng với cust-dl-0002
      };

      await expect(
        service.updateAgency("cust-dl-0001", updateDto),
      ).rejects.toThrow(BadRequestException);
    });

    it("cho phép giữ nguyên agencyCode khi cập nhật", async () => {
      const updateDto: UpdateAgencyDto = {
        agencyCode: "DL-0001", // Giữ nguyên mã của chính nó
        name: "Minh Khang Giữ Nguyên Mã",
      };

      const updated = await service.updateAgency("cust-dl-0001", updateDto);
      expect(updated.agencyCode).toBe("DL-0001");
      expect(updated.name).toBe("Minh Khang Giữ Nguyên Mã");
    });
  });

  describe("4. Ràng buộc toàn vẹn khi Xóa / Ngừng giao dịch (Delete / Deactivate)", () => {
    it("nếu đại lý ĐÃ PHÁT SINH GIAO DỊCH (orders): KHÔNG ĐƯỢC XÓA khỏi database, tự động chuyển status sang INACTIVE (ngừng giao dịch)", async () => {
      // cust-dl-0001 đã phát sinh giao dịch đơn hàng
      const initial = await service.getAgencyById("cust-dl-0001");
      expect(initial.status).toBe(AgencyStatus.ACTIVE);

      const result = await service.deleteAgency("cust-dl-0001");

      // Phải báo thành công nhưng là chuyển trạng thái (deactivated), không xóa
      expect(result.success).toBe(true);
      expect(result.isDeactivated).toBe(true);
      expect(result.isDeleted).toBe(false);
      expect(result.message).toContain("INACTIVE");
      expect(result.data?.status).toBe(AgencyStatus.INACTIVE);

      // Bản ghi vẫn phải tồn tại trong cơ sở dữ liệu / bộ nhớ
      const stillExisting = await service.getAgencyById("cust-dl-0001");
      expect(stillExisting).toBeDefined();
      expect(stillExisting.status).toBe(AgencyStatus.INACTIVE);
    });

    it("nếu đại lý CHƯA PHÁT SINH GIAO DỊCH: Cho phép xóa vĩnh viễn khỏi hệ thống", async () => {
      // cust-dl-0004 chưa phát sinh giao dịch
      const result = await service.deleteAgency("cust-dl-0004");

      expect(result.success).toBe(true);
      expect(result.isDeleted).toBe(true);
      expect(result.isDeactivated).toBe(false);

      // Đã bị xóa hoàn toàn khỏi cơ sở dữ liệu / bộ nhớ
      await expect(service.getAgencyById("cust-dl-0004")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("hỗ trợ chức năng deactivate chuyển trạng thái sang INACTIVE chủ động", async () => {
      const deactivated = await service.deactivateAgency("cust-dl-0005");
      expect(deactivated.status).toBe(AgencyStatus.INACTIVE);

      const fetched = await service.getAgencyById("cust-dl-0005");
      expect(fetched.status).toBe(AgencyStatus.INACTIVE);
    });
  });
});
