import { Pool } from 'pg';
import { databaseConnectionConfig } from '../src/database/database.config';

const pool = new Pool(databaseConnectionConfig);

async function main() {
  console.log('--- 1. CẬP NHẬT CATEGORY_ID CHO CÁC SẢN PHẨM TRONG POSTGRESQL ---');
  
  // 1. Cập nhật các sản phẩm hiện có trong PostgreSQL theo đúng ngành hàng trên cây
  const updates = [
    // Sữa hạt organic -> category 18 (MILK_NUT)
    { condition: "sku LIKE 'LH-MILK%' OR sku = 'LH-NUT-180ML' OR name ILIKE '%Sữa Hạt%'", categoryId: 18 },
    // Sữa bột trẻ em -> category 28 (MILK_POWDER_BABY)
    { condition: "sku LIKE 'TEST-BABY%' OR name ILIKE '%Sữa Bột Trẻ Em%'", categoryId: 28 },
    // Sữa bột dinh dưỡng -> category 17 (MILK_POWDER)
    { condition: "sku = 'LH-MILK-900G' OR sku = 'LH-MILK-POWDER-900G' OR name ILIKE '%Sữa Bột Dinh Dưỡng%'", categoryId: 17 },
    // Sữa tươi & tiệt trùng -> category 19 (MILK_READY)
    { condition: "sku = 'LH-MILK-PAST-1L' OR name ILIKE '%Sữa Tươi%'", categoryId: 19 },
    // Nước yến chưng sẵn -> category 20 (NEST_READY)
    { condition: "sku = 'LH-NEST-70ML' OR name ILIKE '%Nước Yến Sào Chưng%'", categoryId: 20 },
    // Tổ yến sào tinh chế -> category 21 (NEST_PURE)
    { condition: "sku = 'LH-NEST-PREM-100G' OR name ILIKE '%Tổ Yến Sào Tinh Chế%'", categoryId: 21 },
    // Ngũ cốc hạt mầm -> category 22 (CEREAL_SPROUT)
    { condition: "sku = 'LH-CEREAL-500G' OR name ILIKE '%Ngũ Cốc Dinh Dưỡng Hạt Mầm%'", categoryId: 22 },
    // Hạt dinh dưỡng sấy giòn -> category 23 (CEREAL_NUTS)
    { condition: "sku = 'LH-NUTS-MIX-250G' OR name ILIKE '%Hạt Hỗn Hợp Macca%'", categoryId: 23 },
    // Collagen -> category 24 (SUPP_COLLAGEN)
    { condition: "sku = 'LH-COLLAGEN-50ML' OR name ILIKE '%Collagen%'", categoryId: 24 },
    // Trà thảo mộc -> category 4 (TEA_JUICE) hoặc 8 (GREEN_TEA)
    { condition: "sku = 'LH-TEA-240ML' OR name ILIKE '%Trà Hoa Cúc%'", categoryId: 4 },
    // Nước khoáng -> category 3 (WATER) hoặc 7 (PURE_BOTTLE)
    { condition: "sku = 'LH-WATER-500ML' OR name ILIKE '%Nước Khoáng Kiềm%'", categoryId: 3 },
    // Cà phê lon -> category 4 (TEA_JUICE)
    { condition: "sku = 'LH-OLD-COFFEE-CAN' OR name ILIKE '%Cà Phê Sữa Đóng Lon%'", categoryId: 4 },
  ];

  for (const u of updates) {
    const res = await pool.query(`UPDATE products SET category_id = $1 WHERE ${u.condition} RETURNING sku, name;`, [u.categoryId]);
    if (res.rows.length > 0) {
      console.log(`   ✅ Đã gán category_id = ${u.categoryId} cho ${res.rows.length} SP:`);
      res.rows.forEach(r => console.log(`      -> [${r.sku}] ${r.name}`));
    }
  }

  // 2. Chèn toàn bộ các sản phẩm mẫu chuẩn nếu chưa có trong PostgreSQL
  const catalogProducts = [
    { sku: 'LH-MILK-POWDER-900G', name: 'Sữa Bột Dinh Dưỡng Cao Cấp Loha Gold 900g', categoryId: 17, baseUnit: 'Hộp', costPrice: 385000 },
    { sku: 'LH-NUT-180ML', name: 'Sữa Hạt Óc Chó Hạnh Nhân Organic 180ml', categoryId: 18, baseUnit: 'Lốc', costPrice: 42000 },
    { sku: 'LH-NEST-70ML', name: 'Nước Yến Sào Chưng Đường Phèn Loha Nest 70ml', categoryId: 20, baseUnit: 'Hũ', costPrice: 38000 },
    { sku: 'LH-CEREAL-500G', name: 'Ngũ Cốc Dinh Dưỡng Hạt Mầm Loha Meal 500g', categoryId: 22, baseUnit: 'Hộp', costPrice: 95000 },
    { sku: 'LH-COLLAGEN-50ML', name: 'Nước Uống Collagen Đông Trùng Hạ Thảo 50ml', categoryId: 24, baseUnit: 'Hộp', costPrice: 320000 },
    { sku: 'LH-TEA-240ML', name: 'Trà Hoa Cúc La Hán Quả Thanh Nhiệt 240ml', categoryId: 4, baseUnit: 'Chai', costPrice: 11500 },
    { sku: 'LH-WATER-500ML', name: 'Nước Khoáng Kiềm Thiên Nhiên Loha Ion 500ml', categoryId: 3, baseUnit: 'Chai', costPrice: 6500 },
    { sku: 'LH-MILK-PAST-1L', name: 'Sữa Tươi Thanh Trùng Nguyên Chất 1 Lít', categoryId: 19, baseUnit: 'Chai', costPrice: 28000 },
    { sku: 'LH-NEST-PREM-100G', name: 'Hộp Quà Yến Sào Tinh Chế Thượng Hạng 100g', categoryId: 21, baseUnit: 'Hộp', costPrice: 3400000 },
    { sku: 'LH-NUTS-MIX-250G', name: 'Hạt Hỗn Hợp Macca Óc Chó Hạnh Nhân Sấy Giòn 250g', categoryId: 23, baseUnit: 'Hũ', costPrice: 110000 },
    { sku: 'LH-OLD-COFFEE-CAN', name: 'Cà Phê Sữa Đóng Lon Loha Classic 240ml (Mẫu Cũ)', categoryId: 4, baseUnit: 'Lon', costPrice: 12000 },
  ];

  console.log('\n--- 2. CHÈN / ĐỒNG BỘ CÁC SKU CHUẨN VÀO POSTGRESQL ---');
  for (const cp of catalogProducts) {
    const res = await pool.query(`
      INSERT INTO products (sku, name, category_id, base_unit, cost_price, status)
      VALUES ($1, $2, $3, $4, $5, 'ACTIVE')
      ON CONFLICT (sku) DO UPDATE SET 
        name = EXCLUDED.name,
        category_id = EXCLUDED.category_id,
        cost_price = EXCLUDED.cost_price,
        updated_at = CURRENT_TIMESTAMP
      RETURNING sku, name, category_id;
    `, [cp.sku, cp.name, cp.categoryId, cp.baseUnit, cp.costPrice]);
    console.log(`   -> [${res.rows[0].sku}] ${res.rows[0].name} | category_id: ${res.rows[0].category_id}`);
  }

  // 3. Dọn dẹp các sản phẩm test rác (như RWEREWR, AASSSSS, DASDADSADSD) nếu không còn dùng
  await pool.query(`DELETE FROM products WHERE sku IN ('RWEREWR', 'AASSSSS', 'DASDADSADSD', 'LH-MILK-900');`);

  console.log('\n--- 3. KIỂM TRA LẠI TẤT CẢ SẢN PHẨM VÀ NHÁNH CÂY TRONG POSTGRESQL ---');
  const finalCheck = await pool.query(`
    SELECT p.sku, p.name, p.category_id, c.code as cat_code, c.name as cat_name, c.level as cat_level,
           pcat.name as parent_cat_name
    FROM products p
    JOIN categories c ON p.category_id = c.id
    LEFT JOIN categories pcat ON c.parent_id = pcat.id
    ORDER BY c.level ASC, p.category_id ASC, p.name ASC;
  `);

  console.log(`Tổng số sản phẩm chuẩn trong PostgreSQL: ${finalCheck.rows.length}`);
  finalCheck.rows.forEach(r => {
    console.log(`   [${r.sku}] ${r.name}`);
    console.log(`       ↳ Thuộc nhánh: [ID ${r.category_id}] ${r.cat_name} (Code: ${r.cat_code}, Cấp: ${r.cat_level}) | Cha: ${r.parent_cat_name || 'Gốc'}`);
  });
}

main().finally(() => pool.end());
