/**
 * DTO phản hồi kết quả tải lên ảnh đại diện (SN-144)
 */

export interface AvatarData {
  avatarUrl: string;
}

export class AvatarResponseDto {
  statusCode: number;
  message: string;
  data: AvatarData;
}
