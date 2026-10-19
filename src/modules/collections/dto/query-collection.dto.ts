import { IsOptional, IsString } from 'class-validator';

export class QueryCollectionDto {
  @IsOptional()
  @IsString()
  sales_rep_id?: string;

  @IsOptional()
  @IsString()
  agency_id?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  from_date?: string;

  @IsOptional()
  @IsString()
  to_date?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}

export class QueryReconciliationDto {
  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsString()
  from_date?: string;

  @IsOptional()
  @IsString()
  to_date?: string;

  @IsOptional()
  @IsString()
  sales_rep_id?: string;
}
