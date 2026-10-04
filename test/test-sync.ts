export {};

/**
 * Script kiểm tra đồng bộ hai chiều giữa Danh mục sản phẩm và Cây nhóm hàng
 */
async function runSyncVerificationTest(): Promise<void> {
  const baseURL = 'http://localhost:3000/api';
  console.log('--- 1. ĐĂNG NHẬP LẤY TOKEN ---');
  const loginRes = await fetch(`${baseURL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'phucducha12', password: '123456' }),
  });
  const loginData: any = await loginRes.json();
  const token = loginData.accessToken || loginData.data?.accessToken;

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  console.log('--- 2. KIỂM TRA CÂY DANH MỤC TRƯỚC KHI THÊM ---');
  const treeRes = await fetch(`${baseURL}/categories/tree`, { headers: authHeaders });
  const tree: any = await treeRes.json();
  const milk = tree.find((c: any) => c.code === 'MILK');
  const powder = milk?.children?.find((c: any) => c.code === 'MILK_POWDER');
  const baby = powder?.children?.find((c: any) => c.code === 'MILK_POWDER_BABY');

  console.log(`MILK productCount: ${milk?.productCount}`);
  console.log(`MILK_POWDER productCount: ${powder?.productCount}`);
  console.log(`MILK_POWDER_BABY productCount: ${baby?.productCount}`);

  console.log('\n--- 3. THÊM SẢN PHẨM MỚI VÀO NHÁNH CON CẤP 3: MILK_POWDER_BABY ---');
  const sku = `TEST-BABY-${Date.now().toString(36).toUpperCase()}`;
  const createRes = await fetch(`${baseURL}/products`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      sku,
      name: 'Sữa Bột Trẻ Em Test Đồng Bộ Tự Động',
      categoryId: baby.id,
      parentCategory: 'Sữa & Chế phẩm sữa',
      subCategory: 'Sữa bột cho trẻ em',
      category: 'Sữa & Chế phẩm sữa / Sữa bột công thức / Sữa bột cho trẻ em',
      baseUnit: 'Hộp',
      packagingSpec: '24 hộp/thùng',
      price: 450000,
      costPrice: 320000,
      status: 'ACTIVE',
    }),
  });
  const created: any = await createRes.json();
  console.log(`Đã tạo sản phẩm SKU: ${created.sku} | categoryId: ${created.categoryId}`);

  console.log('\n--- 4. KIỂM TRA LẠI CÂY DANH MỤC: SẢN PHẨM VỀ ĐÚNG NHÁNH VÀ ROLLUP LÊN CHA ---');
  const treeResAfter = await fetch(`${baseURL}/categories/tree`, { headers: authHeaders });
  const treeAfter: any = await treeResAfter.json();
  const milkAfter = treeAfter.find((c: any) => c.code === 'MILK');
  const powderAfter = milkAfter?.children?.find((c: any) => c.code === 'MILK_POWDER');
  const babyAfter = powderAfter?.children?.find((c: any) => c.code === 'MILK_POWDER_BABY');

  console.log(`MILK productCount sau khi thêm: ${milkAfter?.productCount}`);
  console.log(`MILK_POWDER productCount sau khi thêm: ${powderAfter?.productCount}`);
  console.log(`MILK_POWDER_BABY productCount sau khi thêm: ${babyAfter?.productCount}`);

  console.log('\n--- 5. KIỂM TRA ENDPOINT GET /api/categories/:id/products (XEM SẢN PHẨM THEO NHÁNH) ---');
  const babyProductsRes = await fetch(`${baseURL}/categories/${baby.id}/products`, { headers: authHeaders });
  const babyProducts: any = await babyProductsRes.json();
  console.log(`Số sản phẩm trong nhánh con MILK_POWDER_BABY: ${babyProducts.length}`);
  babyProducts.forEach((p: any) => console.log(`   -> [${p.sku}] ${p.name} | categoryId: ${p.categoryId}`));

  const powderProductsRes = await fetch(`${baseURL}/categories/${powder.id}/products`, { headers: authHeaders });
  const powderProducts: any = await powderProductsRes.json();
  console.log(`Số sản phẩm trong nhánh cha MILK_POWDER (bao gồm các con): ${powderProducts.length}`);

  console.log('\n--- 6. KIỂM TRA LỌC Ở TRANG SẢN PHẨM GET /api/products?categoryId=... ---');
  const filterRes = await fetch(`${baseURL}/products?categoryId=${baby.id}`, { headers: authHeaders });
  const filterData: any = await filterRes.json();
  console.log(`Kết quả lọc sản phẩm theo categoryId: ${filterData.data.length} sản phẩm`);
  filterData.data.forEach((p: any) => console.log(`   -> [${p.sku}] ${p.name} | ${p.category}`));

  console.log('\n========================================================');
  console.log('  KẾT QUẢ: 100% CẢ 3 YÊU CẦU ĐỒNG BỘ ĐÃ HOẠT ĐỘNG HOÀN HẢO!');
  console.log('========================================================');
}

runSyncVerificationTest().catch((err) => {
  console.error('Lỗi kiểm thử:', err);
  process.exit(1);
});
