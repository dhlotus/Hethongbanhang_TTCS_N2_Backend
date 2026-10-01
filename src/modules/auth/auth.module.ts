import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

export class AuthModule {
  controllers = [AuthController];
  providers = [AuthService];
  exports = [AuthService];
}
