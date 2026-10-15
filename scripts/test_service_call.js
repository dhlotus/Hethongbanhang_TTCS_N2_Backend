const { Test } = require('@nestjs/testing');
const { AppModule } = require('../dist/app.module');
const { InventoryService } = require('../dist/modules/inventory/inventory.service');

async function test() {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const inventoryService = moduleRef.get(InventoryService);
  const mtId = '11111111-0000-0000-0000-000000000004';
  const mbId = '11111111-0000-0000-0000-000000000002';

  console.log('--- Calling getStockOverview for Kho Miền Trung ---');
  const mtOverview = await inventoryService.getStockOverview({ warehouse: mtId });
  console.log('Items returned:', mtOverview.length);
  const mtTotalReserved = mtOverview.reduce((sum, x) => sum + (x.reservedStock || 0), 0);
  console.log('Kho Miền Trung Total Reserved:', mtTotalReserved);
  console.log('Kho Miền Trung First 3:', mtOverview.slice(0, 3).map(x => ({
    sku: x.sku,
    physicalStock: x.physicalStock,
    reservedStock: x.reservedStock,
    availableStock: x.availableStock
  })));

  console.log('\n--- Calling getStockOverview for Kho Miền Bắc ---');
  const mbOverview = await inventoryService.getStockOverview({ warehouse: mbId });
  const mbTotalReserved = mbOverview.reduce((sum, x) => sum + (x.reservedStock || 0), 0);
  console.log('Kho Miền Bắc Total Reserved:', mbTotalReserved);
  console.log('Kho Miền Bắc First 3:', mbOverview.slice(0, 3).map(x => ({
    sku: x.sku,
    physicalStock: x.physicalStock,
    reservedStock: x.reservedStock,
    availableStock: x.availableStock
  })));

  process.exit(0);
}

test().catch(err => {
  console.error(err);
  process.exit(1);
});
