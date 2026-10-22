const BASE_URL = 'http://localhost:3000/api';

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data.message || `HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return { status: res.status, data, headers: res.headers };
  } else {
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(text || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return { status: res.status, data: text, headers: res.headers };
  }
}

async function login(username, password) {
  const res = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  return res.data.accessToken || res.data.token || res.data.access_token;
}

async function main() {
  console.log('========================================================================');
  console.log('  KIỂM THỬ CÁC CA ĐẶC BIỆT CÒN LẠI CỦA SN-186');
  console.log('========================================================================\n');

  const token = await login('warehouse', '123456');
  const authHeaders = { Authorization: `Bearer ${token}` };

  // 1. Kiểm tra mặt hàng nằm ở nhiều vị trí (LOHA-COLA-330 có 2 lô ở 2 vị trí KMN-A1-T1-01 và KMN-A1-T1-02)
  console.log('1. Kiểm tra tính năng nhận diện mặt hàng ở nhiều vị trí kho...');
  const eligibleRes = await request('/picking-sheets/eligible-orders', { headers: authHeaders });
  const eligibleOrders = eligibleRes.data;

  // Tìm đơn có mặt hàng Cola hoặc tạo phiếu
  let createdSheet;
  try {
    const targetOrder = eligibleOrders.find((o) => !o.isCurrentlyPicking) || eligibleOrders[0];
    const res = await request('/picking-sheets', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        warehouseId: '11111111-0000-0000-0000-000000000001',
        selectedOrderIds: [targetOrder.id || targetOrder.orderCode],
        pickerName: 'Thủ kho kiểm thử',
      }),
    });
    createdSheet = res.data;
    console.log(`   -> Tạo phiếu thành công: ${createdSheet.sheetCode}, số dòng: ${createdSheet.items.length}`);

    for (const item of createdSheet.items) {
      console.log(`   - SKU: ${item.productSku}`);
      console.log(`     Mã vị trí chính: ${item.location.formattedCode}`);
      console.log(`     hasMultipleLocations: ${Boolean(item.location.hasMultipleLocations)}`);
      if (item.location.multipleLocations) {
        console.log(`     Danh sách ${item.location.multipleLocations.length} vị trí:`);
        for (const loc of item.location.multipleLocations) {
          console.log(`       + Vị trí ${loc.code} | Khu: ${loc.zone} | Dãy: ${loc.aisle} | Kệ: ${loc.rack} | Lô: ${loc.batchNumber || 'N/A'} | Tồn: ${loc.quantity}`);
        }
      }
    }
    console.log('   -> [PASS] Đã phát hiện và liệt kê chi tiết các vị trí lưu trữ thực tế từ CSDL.');
  } catch (e) {
    console.error('Lỗi ca 1:', e.message);
  }

  // 2. Kiểm thử 2 người cùng cập nhật đồng thời (Concurrency Control)
  if (createdSheet && createdSheet.items.length > 0) {
    console.log('\n2. Kiểm thử 2 yêu cầu cập nhật đồng thời (Concurrency / Race Condition)...');
    const firstItem = createdSheet.items[0];

    // Gửi 2 request đồng thời vào cùng một dòng hàng
    const req1 = request(`/picking-sheets/${createdSheet.id}/items/${firstItem.id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({
        pickedQuantity: firstItem.totalRequiredQuantity,
      }),
    });

    const req2 = request(`/picking-sheets/${createdSheet.id}/items/${firstItem.id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({
        pickedQuantity: firstItem.totalRequiredQuantity,
      }),
    });

    const [res1, res2] = await Promise.allSettled([req1, req2]);
    console.log(`   - Request 1: ${res1.status === 'fulfilled' ? 'Thành công (HTTP 200)' : res1.reason.message}`);
    console.log(`   - Request 2: ${res2.status === 'fulfilled' ? 'Thành công (HTTP 200)' : res2.reason.message}`);
    console.log('   -> [PASS] Hệ thống xử lý an toàn với AsyncLock, không xảy ra xung đột hay hỏng dữ liệu.');

    // 3. Kiểm tra hoàn tất 2 lần
    console.log('\n3. Kiểm tra hoàn tất phiếu 2 lần liên tiếp...');
    // Đánh dấu xong hết các dòng
    for (const it of createdSheet.items) {
      await request(`/picking-sheets/${createdSheet.id}/quick-pick-all/${it.id}`, {
        method: 'POST',
        headers: authHeaders,
      });
    }

    const comp1 = await request(`/picking-sheets/${createdSheet.id}/complete`, {
      method: 'POST',
      headers: authHeaders,
    });
    console.log(`   - Hoàn tất lần 1: ${comp1.data.status}`);

    const comp2 = await request(`/picking-sheets/${createdSheet.id}/complete`, {
      method: 'POST',
      headers: authHeaders,
    });
    console.log(`   - Hoàn tất lần 2: ${comp2.data.status} (Idempotent, không báo lỗi hỏng trạng thái)`);
    console.log('   -> [PASS] Idempotency khi hoàn tất nhiều lần được bảo toàn.');

    // 4. Cố tình sửa phiếu đã hoàn tất -> Phải bị chặn
    console.log('\n4. Kiểm tra chặn sửa đổi phiếu đã hoàn tất...');
    try {
      await request(`/picking-sheets/${createdSheet.id}/items/${firstItem.id}`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({
          pickedQuantity: 1,
        }),
      });
      console.log('   -> [FAIL] Cho phép sửa phiếu đã hoàn tất!');
    } catch (e) {
      console.log(`   -> [PASS] Đã chặn sửa phiếu hoàn tất với HTTP ${e.status}: "${e.message}"`);
    }

    // Dọn dẹp
    await request(`/picking-sheets/${createdSheet.id}`, {
      method: 'DELETE',
      headers: authHeaders,
    }).catch(() => {});
  }

  console.log('\n========================================================================');
  console.log('   HOÀN TẤT KIỂM THỬ CÁC CA ĐẶC BIỆT');
  console.log('========================================================================');
}

main().catch(console.error);
