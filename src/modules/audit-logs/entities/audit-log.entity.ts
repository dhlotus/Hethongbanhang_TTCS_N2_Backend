import { AuditAction, AuditEntity } from '../../../common/enums';

export interface AuditLogUserInfo {
  id: string;
  full_name: string;
  email: string;
  role?: string;
  ip_address: string;
}

export class AuditLogEntity {
  id: string; // UUID, PK
  user_id: string; // UUID, FK, Not Null
  action: AuditAction | string; // CREATE, UPDATE, DELETE, APPROVE, CANCEL, STOCK_ADJUST
  entity_name: AuditEntity | string; // INVENTORY, DEBT, PRICING, ORDER, USER...
  entity_id: string; // ID của bản ghi/đối tượng bị tác động
  old_values: Record<string, unknown> | null; // JSONB
  new_values: Record<string, unknown> | null; // JSONB
  ip_address: string; // Địa chỉ IP client
  created_at: Date; // TIMESTAMP Default NOW()
  summary?: string; // Tóm tắt nghiệp vụ tự động

  // Thông tin user được liên kết (JOIN) từ users table/entity
  user?: AuditLogUserInfo;

  constructor(partial: Partial<AuditLogEntity>) {
    this.id = partial.id || '';
    this.user_id = partial.user_id || '';
    this.action = partial.action || AuditAction.UPDATE;
    this.entity_name = partial.entity_name || AuditEntity.INVENTORY;
    this.entity_id = partial.entity_id || '';
    this.old_values = partial.old_values ?? null;
    this.new_values = partial.new_values ?? null;
    this.ip_address = partial.ip_address || '127.0.0.1';
    this.created_at = partial.created_at ? new Date(partial.created_at) : new Date();
    this.summary = partial.summary;
    this.user = partial.user;
  }
}
