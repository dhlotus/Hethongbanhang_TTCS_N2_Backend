export type WarehouseStatus = 'ACTIVE' | 'INACTIVE';
export type WarehouseLocationStatus = 'ACTIVE' | 'MAINTENANCE' | 'INACTIVE';

export interface WarehouseEntity {
  id: string;
  code: string;
  name: string;
  address: string;
  phone: string | null;
  managerId: string | null;
  status: WarehouseStatus;
  createdAt?: Date;
  updatedAt?: Date;
  locationCount?: number;
}

export interface WarehouseLocationEntity {
  id: string;
  warehouseId: string;
  code: string;
  zone: string;
  aisle: string | null;
  rack: string | null;
  shelf: string | null;
  bin: string | null;
  status: WarehouseLocationStatus;
}

export interface WarehouseManagerEntity {
  id: string;
  name: string;
}

export interface AgencyWarehouseAssignmentEntity {
  agencyId: string;
  warehouseId: string;
}

export interface AgencyWarehouseDetailEntity extends AgencyWarehouseAssignmentEntity {
  warehouseCode: string;
  warehouseName: string;
}

export interface AgencyWarehouseUpdateEntity {
  agencyId: string;
  defaultWarehouseId: string | null;
}
