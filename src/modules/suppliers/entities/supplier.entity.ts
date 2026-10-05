import { SupplierStatus } from '../../../common/enums/supplier-status.enum';

/**
 * Thực thể Nhà Cung Cấp (Bảng suppliers) - SN-25:
 * Quản lý thông tin nhà cung cấp, mã số thuế, đầu mối liên hệ, điều khoản thanh toán,
 * trạng thái hoạt động và ràng buộc phiếu nhập kho.
 */
export class SupplierEntity {
  id: string;
  code: string;
  name: string;
  taxCode?: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
  paymentTerms?: string;
  status: SupplierStatus;
  notes?: string;
  hasReceipts: boolean;
  createdAt: Date;
  updatedAt: Date;

  constructor(partial: Partial<SupplierEntity> & Record<string, unknown>) {
    Object.assign(this, partial);

    // Map snake_case to camelCase
    if (partial.tax_code !== undefined && !this.taxCode) {
      this.taxCode = partial.tax_code as string;
    }
    if (partial.contact_name !== undefined && !this.contactName) {
      this.contactName = partial.contact_name as string;
    }
    if (partial.payment_terms !== undefined && !this.paymentTerms) {
      this.paymentTerms = partial.payment_terms as string;
    }
    if (partial.has_receipts !== undefined) {
      this.hasReceipts = Boolean(partial.has_receipts);
    } else if (this.hasReceipts === undefined) {
      this.hasReceipts = false;
    }

    if (!this.status) {
      this.status = SupplierStatus.ACTIVE;
    }

    const now = new Date();
    this.createdAt = partial.createdAt
      ? new Date(partial.createdAt)
      : partial.created_at
        ? new Date(partial.created_at as string | number | Date)
        : now;

    this.updatedAt = partial.updatedAt
      ? new Date(partial.updatedAt)
      : partial.updated_at
        ? new Date(partial.updated_at as string | number | Date)
        : now;
  }

  get tax_code(): string | undefined {
    return this.taxCode;
  }

  get contact_name(): string | undefined {
    return this.contactName;
  }

  get payment_terms(): string | undefined {
    return this.paymentTerms;
  }

  get has_receipts(): boolean {
    return this.hasReceipts;
  }

  get created_at(): Date {
    return this.createdAt;
  }

  get updated_at(): Date {
    return this.updatedAt;
  }

  /**
   * Serialize đối tượng đảm bảo cung cấp đầy đủ cả camelCase (frontend) và snake_case (database schema)
   */
  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      code: this.code,
      name: this.name,
      taxCode: this.taxCode,
      tax_code: this.taxCode,
      contactName: this.contactName,
      contact_name: this.contactName,
      phone: this.phone,
      email: this.email,
      address: this.address,
      paymentTerms: this.paymentTerms,
      payment_terms: this.paymentTerms,
      status: this.status,
      notes: this.notes,
      hasReceipts: this.hasReceipts,
      has_receipts: this.hasReceipts,
      createdAt: this.createdAt,
      created_at: this.createdAt,
      updatedAt: this.updatedAt,
      updated_at: this.updatedAt,
    };
  }
}
