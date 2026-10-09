import { Test, TestingModule } from "@nestjs/testing";
import { AgencyController } from "./agency.controller";
import { AgencyService } from "./agency.service";
import { AgencyStatus } from "./enums/agency-status.enum";
import { CreateAgencyDto, UpdateAgencyDto } from "./dto";

describe("AgencyController (JIRA SN-30)", () => {
  let controller: AgencyController;
  let service: AgencyService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgencyController],
      providers: [AgencyService],
    }).compile();

    controller = module.get<AgencyController>(AgencyController);
    service = module.get<AgencyService>(AgencyService);
  });

  it("phải khởi tạo controller thành công", () => {
    expect(controller).toBeDefined();
  });

  it("GET /agencies: Lấy danh sách đại lý", async () => {
    const result = await controller.getAgencies({});
    expect(Array.isArray(result)).toBe(true);
  });

  it("GET /agencies/:id: Lấy chi tiết đại lý", async () => {
    const result = await controller.getAgencyById("cust-dl-0001");
    expect(result.agencyCode).toBe("DL-0001");
  });

  it("POST /agencies: Tạo mới đại lý", async () => {
    const dto: CreateAgencyDto = {
      agencyCode: "DL-TEST-99",
      name: "Đại Lý Thử Nghiệm Controller",
      customerGroupId: "AGENT_LEVEL_1",
    };
    const created = await controller.createAgency(dto);
    expect(created.agencyCode).toBe("DL-TEST-99");
  });

  it("PUT /agencies/:id: Cập nhật thông tin đại lý", async () => {
    const dto: UpdateAgencyDto = {
      name: "Đại Lý Cập Nhật Mới",
    };
    const updated = await controller.updateAgency("cust-dl-0002", dto);
    expect(updated.name).toBe("Đại Lý Cập Nhật Mới");
  });

  it("PATCH /agencies/:id/deactivate: Ngừng giao dịch đại lý", async () => {
    const result = await controller.deactivateAgency("cust-dl-0002");
    expect(result.status).toBe(AgencyStatus.INACTIVE);
  });

  it("DELETE /agencies/:id: Tự động chuyển INACTIVE nếu có đơn hàng", async () => {
    const result = await controller.deleteAgency("cust-dl-0001");
    expect(result.success).toBe(true);
    expect(result.isDeactivated).toBe(true);
  });
});
