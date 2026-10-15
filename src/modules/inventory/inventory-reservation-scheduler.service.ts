import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { OrdersService } from '../orders/orders.service';

/**
 * Service định kỳ kiểm tra và tự động nhả tồn giữ chỗ cho các đơn hàng quá hạn (SN-180 AC2)
 */
@Injectable()
export class InventoryReservationSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(InventoryReservationSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private readonly checkIntervalMs = 60 * 1000; // Kiểm tra mỗi 60 giây

  constructor(
    @Inject(forwardRef(() => OrdersService))
    private readonly ordersService: OrdersService,
  ) {}

  onModuleInit(): void {
    this.startScheduler();
  }

  onModuleDestroy(): void {
    this.stopScheduler();
  }

  startScheduler(): void {
    if (this.timer) return;
    this.logger.log(
      `[Scheduler] Khởi chạy worker tự động nhả tồn giữ chỗ quá hạn (chu kỳ ${this.checkIntervalMs / 1000}s).`,
    );
    this.timer = setInterval(async () => {
      await this.triggerExpiredCheck();
    }, this.checkIntervalMs);
  }

  stopScheduler(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.log('[Scheduler] Đã dừng worker tự động nhả tồn.');
    }
  }

  async triggerExpiredCheck(): Promise<{
    releasedReservations: number;
    cancelledOrders: number;
  }> {
    try {
      const result = await this.ordersService.releaseExpiredReservations();
      if (result.releasedReservations > 0) {
        this.logger.log(
          `[Scheduler] Đã tự động giải phóng ${result.releasedReservations} bản ghi giữ chỗ quá hạn, hủy ${result.cancelledOrders} đơn hàng.`,
        );
      }
      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[Scheduler] Lỗi khi quét nhả tồn giữ chỗ quá hạn: ${message}`);
      return { releasedReservations: 0, cancelledOrders: 0 };
    }
  }
}
