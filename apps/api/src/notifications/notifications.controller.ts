import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiCookieAuth()
@Controller()
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('notifications')
  list(@CurrentUser() user: AuthUser, @Query('unread') unread?: string) {
    return this.notifications.list(user, unread === 'true');
  }

  @Post('notifications/read-all')
  readAll(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user);
  }

  @Post('notifications/:id/read')
  read(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notifications.markRead(user, id);
  }

  /** Inbox FINANCE: termin dengan tanggal invoice belum diisi. */
  @Get('inbox/missing-invoice-dates')
  @Roles('ADMIN', 'FINANCE', 'DIREKTUR')
  missing() {
    return this.notifications.missingInvoiceDates();
  }
}
