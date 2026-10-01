import { UsersController } from './users.controller';
import { UsersService } from './users.service';

export class UsersModule {
  controllers = [UsersController];
  providers = [UsersService];
  exports = [UsersService];
}
