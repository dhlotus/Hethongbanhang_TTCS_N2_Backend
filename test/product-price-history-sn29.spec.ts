import { ProductsService } from '../src/modules/products/products.service';
import { ProductPriceHistory } from '../src/modules/products/entities/product-price-history.entity';

/**
 * BỘ KIỂM THỬ TỰ ĐỘNG USER STORY SN-29:
 * "Xem lịch sử thay đổi giá sản phẩm"
 *
 * TIÊU CHÍ NGHIỆM THU (DEFINITION OF DONE):
 * 1. Bảng / Entity ProductPriceHistory lưu trữ các trường: id, productId, oldPrice, newPrice, changedBy, changedAt.
 * 2. Cập nhật giá sản phẩm A -> Ghi nhận lịch sử cho A với oldPrice và newPrice chính xác.
 * 3. Mở lịch sử của sản phẩm B -> Chỉ hiển thị lịch sử của B, không bị lẫn sang sản phẩm khác.
 * 4. Nếu giá không đổi (oldPrice === newPrice) -> Không tạo bản ghi lịch sử thừa thãi.
 * 5. Lịch sử được sắp xếp theo thời gian mới nhất lên đầu (changedAt DESC).
 * 6. Quy tắc bất biến: Bảng lịch sử là append-only, không cung cấp API sửa/xóa.
 */
describe('[SN-29] Xem lịch sử thay đổi giá sản phẩm', () => {
  let productsService: ProductsService;

  beforeEach(() => {
    productsService = new ProductsService();
  });

  it('TC-01: Sản phẩm mới chưa đổi giá thì danh sách lịch sử trả về mảng rỗng []', async () => {
    const history = await productsService.getPriceHistory('LH-MILK-900G');
    expect(history).toBeDefined();
    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBe(0);
  });

  it('TC-02: Cập nhật giá sản phẩm A ghi nhận đúng lịch sử (oldPrice -> newPrice và changedBy)', async () => {
    const milk = await productsService.findById('LH-MILK-900G');
    const oldPrice = milk.price; // 520,000đ
    const newPrice = 580000;

    await productsService.update('LH-MILK-900G', { price: newPrice }, 'Nguyễn Văn Khải');

    const updatedMilk = await productsService.findById('LH-MILK-900G');
    expect(updatedMilk.price).toBe(newPrice);

    const history = await productsService.getPriceHistory('LH-MILK-900G');
    expect(history.length).toBe(1);
    expect(history[0].oldPrice).toBe(oldPrice);
    expect(history[0].newPrice).toBe(newPrice);
    expect(history[0].changedBy).toBe('Nguyễn Văn Khải');
    expect(history[0].productId).toBe(milk.id);
    expect(history[0].changedAt).toBeInstanceOf(Date);
  });

  it('TC-03: Mở lịch sử sản phẩm B không bị lẫn lịch sử của sản phẩm A', async () => {
    // Cập nhật giá cho sản phẩm A (LH-MILK-900G)
    await productsService.update('LH-MILK-900G', { price: 600000 }, 'Admin A');

    // Cập nhật giá cho sản phẩm B (LH-NUT-180ML)
    const nut = await productsService.findById('LH-NUT-180ML');
    const nutOldPrice = nut.price;
    await productsService.update('LH-NUT-180ML', { price: nutOldPrice + 5000 }, 'Admin B');

    // Kiểm tra lịch sử của B chỉ có đúng 1 bản ghi của B
    const historyB = await productsService.getPriceHistory('LH-NUT-180ML');
    expect(historyB.length).toBe(1);
    expect(historyB[0].productId).toBe(nut.id);
    expect(historyB[0].oldPrice).toBe(nutOldPrice);
    expect(historyB[0].newPrice).toBe(nutOldPrice + 5000);
    expect(historyB[0].changedBy).toBe('Admin B');

    // Kiểm tra lịch sử của A chỉ thuộc về A
    const historyA = await productsService.getPriceHistory('LH-MILK-900G');
    expect(historyA.length).toBe(1);
    expect(historyA[0].newPrice).toBe(600000);
  });

  it('TC-04: Cập nhật thông tin khác mà không đổi giá thì không tạo bản ghi lịch sử', async () => {
    const milk = await productsService.findById('LH-MILK-900G');
    const currentPrice = milk.price;

    await productsService.update('LH-MILK-900G', {
      name: 'Sữa Bột Dinh Dưỡng Loha Gold Tên Mới',
      price: currentPrice, // Giá không đổi
    }, 'Admin C');

    const history = await productsService.getPriceHistory('LH-MILK-900G');
    expect(history.length).toBe(0);
  });

  it('TC-05: Nhiều lần đổi giá được sắp xếp theo thời gian mới nhất lên đầu (changedAt DESC)', async () => {
    const milk = await productsService.findById('LH-MILK-900G');
    const initPrice = milk.price; // 520,000

    // Lần 1: 520,000 -> 550,000
    await productsService.update('LH-MILK-900G', { price: 550000 }, 'Khai 1');
    // Lần 2: 550,000 -> 580,000
    await productsService.update('LH-MILK-900G', { price: 580000 }, 'Khai 2');
    // Lần 3: 580,000 -> 600,000
    await productsService.update('LH-MILK-900G', { price: 600000 }, 'Khai 3');

    const history = await productsService.getPriceHistory('LH-MILK-900G');
    expect(history.length).toBe(3);

    // Mới nhất lên đầu
    expect(history[0].newPrice).toBe(600000);
    expect(history[0].oldPrice).toBe(580000);
    expect(history[0].changedBy).toBe('Khai 3');

    expect(history[1].newPrice).toBe(580000);
    expect(history[1].oldPrice).toBe(550000);
    expect(history[1].changedBy).toBe('Khai 2');

    expect(history[2].newPrice).toBe(550000);
    expect(history[2].oldPrice).toBe(initPrice);
    expect(history[2].changedBy).toBe('Khai 1');
  });

  it('TC-06: Entity toJSON hỗ trợ cả camelCase và snake_case cho API client', () => {
    const record = new ProductPriceHistory({
      id: 'test-uuid-1',
      productId: 'prod-001',
      oldPrice: 100000,
      newPrice: 120000,
      changedBy: 'Admin',
      changedAt: new Date('2026-10-14T10:00:00Z'),
    });

    const json = record.toJSON();
    expect(json.id).toBe('test-uuid-1');
    expect(json.productId).toBe('prod-001');
    expect(json.product_id).toBe('prod-001');
    expect(json.oldPrice).toBe(100000);
    expect(json.old_price).toBe(100000);
    expect(json.newPrice).toBe(120000);
    expect(json.new_price).toBe(120000);
  });
});
