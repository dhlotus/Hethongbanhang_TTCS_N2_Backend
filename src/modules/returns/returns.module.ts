import { ReturnsController } from './returns.controller';
import { ReturnsService } from './returns.service';

export class ReturnsModule {
  controllers = [ReturnsController];
  providers = [ReturnsService];
  exports = [ReturnsService];
}
