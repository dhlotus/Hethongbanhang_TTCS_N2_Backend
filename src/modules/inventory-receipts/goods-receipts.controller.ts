import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Param,
  Delete,
  Body,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { GoodsReceiptsService } from './goods-receipts.service';
import { CreateGoodsReceiptDto } from './dto/create-goods-receipt.dto';
import { UpdateGoodsReceiptDto } from './dto/update-goods-receipt.dto';
import { QueryGoodsReceiptsDto } from './dto/query-goods-receipts.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';

@Controller('goods-receipts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class GoodsReceiptsController {
  constructor(private readonly goodsReceiptsService: GoodsReceiptsService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.WH_MANAGER, UserRole.WAREHOUSE_MANAGER, UserRole.WAREHOUSE, UserRole.WAREHOUSE_KEEPER)
  create(
    @Body() createGoodsReceiptDto: CreateGoodsReceiptDto,
    @Req() req: { user: ICurrentUser },
  ) {
    return this.goodsReceiptsService.create(createGoodsReceiptDto, req.user);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.WH_MANAGER, UserRole.WAREHOUSE_MANAGER, UserRole.WAREHOUSE, UserRole.WAREHOUSE_KEEPER)
  findAll(@Query() query: QueryGoodsReceiptsDto) {
    return this.goodsReceiptsService.findAll(query);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.WH_MANAGER, UserRole.WAREHOUSE_MANAGER, UserRole.WAREHOUSE, UserRole.WAREHOUSE_KEEPER)
  findOne(@Param('id') id: string) {
    return this.goodsReceiptsService.findOne(id);
  }

  @Put(':id')
  @Roles(UserRole.ADMIN, UserRole.WH_MANAGER, UserRole.WAREHOUSE_MANAGER, UserRole.WAREHOUSE, UserRole.WAREHOUSE_KEEPER)
  update(
    @Param('id') id: string,
    @Body() updateGoodsReceiptDto: UpdateGoodsReceiptDto,
    @Req() req: { user: ICurrentUser },
  ) {
    return this.goodsReceiptsService.update(id, updateGoodsReceiptDto, req.user);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.WH_MANAGER, UserRole.WAREHOUSE_MANAGER, UserRole.WAREHOUSE, UserRole.WAREHOUSE_KEEPER)
  patchUpdate(
    @Param('id') id: string,
    @Body() updateGoodsReceiptDto: UpdateGoodsReceiptDto,
    @Req() req: { user: ICurrentUser },
  ) {
    return this.goodsReceiptsService.update(id, updateGoodsReceiptDto, req.user);
  }

  @Patch(':id/confirm')
  @Roles(UserRole.ADMIN, UserRole.WH_MANAGER, UserRole.WAREHOUSE_MANAGER, UserRole.WAREHOUSE, UserRole.WAREHOUSE_KEEPER)
  confirm(
    @Param('id') id: string,
    @Req() req: { user: ICurrentUser },
  ) {
    return this.goodsReceiptsService.confirm(id, req.user);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.WH_MANAGER, UserRole.WAREHOUSE_MANAGER, UserRole.WAREHOUSE, UserRole.WAREHOUSE_KEEPER)
  remove(@Param('id') id: string) {
    return this.goodsReceiptsService.remove(id);
  }
}
