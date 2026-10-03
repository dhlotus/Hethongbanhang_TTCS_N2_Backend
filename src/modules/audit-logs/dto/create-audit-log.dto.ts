import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { AuditAction, AuditEntity } from '../../../common/enums';

export class CreateAuditLogDto {
  @IsNotEmpty({ message: 'user_id không được để trống' })
  @IsString()
  userId: string;

  @IsNotEmpty({ message: 'action không được để trống' })
  action: AuditAction | string;

  @IsNotEmpty({ message: 'entity_name không được để trống' })
  @IsString()
  entityName: AuditEntity | string;

  @IsNotEmpty({ message: 'entity_id không được để trống' })
  @IsString()
  entityId: string;

  @IsOptional()
  oldValues?: Record<string, unknown> | null;

  @IsOptional()
  newValues?: Record<string, unknown> | null;

  @IsOptional()
  @IsString()
  ipAddress?: string;

  @IsOptional()
  @IsString()
  summary?: string;
}
