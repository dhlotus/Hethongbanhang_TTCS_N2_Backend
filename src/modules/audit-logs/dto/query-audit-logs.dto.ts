import { IsOptional, IsString, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryAuditLogsDto {
  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  entityName?: string;

  @IsOptional()
  @IsString()
  entity?: string; // Hỗ trợ tham số entity từ Frontend

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsString()
  searchUser?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  date_from?: string; // Hỗ trợ tham số date_from từ URL Frontend

  @IsOptional()
  @IsString()
  date_to?: string; // Hỗ trợ tham số date_to từ URL Frontend

  @IsOptional()
  @IsString()
  module?: string; // Hỗ trợ tham số module từ URL Frontend

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number = 20;
}
