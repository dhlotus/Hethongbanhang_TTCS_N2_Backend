import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationEntity } from './entities/notification.entity';
import { QueryNotificationsDto } from './dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { Public } from '../../common/decorators/public.decorator';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * Lấy danh sách thông báo của người dùng hiện tại
   * GET /api/notifications
   */
  @Get()
  @Public()
  @UseGuards(JwtAuthGuard)
  async getNotifications(
    @CurrentUser() currentUser?: ICurrentUser,
    @Query() query?: QueryNotificationsDto,
  ): Promise<NotificationEntity[]> {
    return this.notificationsService.getNotificationsForUser(currentUser, query);
  }

  /**
   * Đánh dấu đã đọc một thông báo
   * PATCH /api/notifications/:id/read
   */
  @Patch(':id/read')
  @Public()
  @UseGuards(JwtAuthGuard)
  async markAsRead(
    @Param('id') id: string,
    @CurrentUser() currentUser?: ICurrentUser,
  ): Promise<{ success: boolean }> {
    const success = await this.notificationsService.markAsRead(id, currentUser);
    return { success };
  }

  /**
   * Đánh dấu tất cả đã đọc
   * PATCH /api/notifications/read-all
   */
  @Patch('read-all')
  @Public()
  @UseGuards(JwtAuthGuard)
  async markAllAsRead(
    @CurrentUser() currentUser?: ICurrentUser,
  ): Promise<{ success: boolean }> {
    const success = await this.notificationsService.markAllAsRead(currentUser);
    return { success };
  }
}
