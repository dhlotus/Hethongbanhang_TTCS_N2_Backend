import { UserRole } from '../../../common/enums/user-role.enum';

export interface ICurrentUser {
  userId: string;
  email: string;
  roles: UserRole[];
  username?: string;
  avatarUrl?: string | null;
  customerId?: string | null;
  customerCode?: string | null;
  agencyId?: string | null;
  warehouseId?: string | null;
  warehouseCode?: string | null;
  warehouseName?: string | null;
  assignedWarehouse?: string | null;
  warehouses?: Array<{ id: string; code: string; name: string; isPrimary?: boolean }>;
}

