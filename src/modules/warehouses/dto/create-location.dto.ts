import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateLocationDto {
  @IsString() @IsNotEmpty() code: string;
  @IsOptional() @IsString() zone?: string;
  @IsOptional() @IsString() aisle?: string;
  @IsOptional() @IsString() rack?: string;
  @IsOptional() @IsString() shelf?: string;
  @IsOptional() @IsString() bin?: string;
  @IsOptional() @IsIn(['ACTIVE', 'MAINTENANCE', 'INACTIVE']) status?: 'ACTIVE' | 'MAINTENANCE' | 'INACTIVE';
}
