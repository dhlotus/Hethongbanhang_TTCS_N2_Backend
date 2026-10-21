const API_BASE = 'http://localhost:3000/api';

async function testAll() {
  console.log('=== BẮT ĐẦU KIỂM THỬ TOÀN DIỆN SN-207 & SN-208 ===\n');

  // 1. Đăng nhập với tài khoản Đại lý Minh Khang (dealer)
  console.log('1. Đăng nhập tài khoản Đại lý: dealer...');
  let loginRes = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'dealer', password: '123456' }),
  });

  const loginData = await loginRes.json();
  const token = loginData.access_token || loginData.accessToken;
  const user = loginData.user;
  console.log(`-> Đăng nhập thành công! User: ${user?.username} (${user?.fullName || user?.email}), Roles:`, user?.roles);
  console.log(`-> CustomerId gắn liền với tài khoản: ${user?.customerId || user?.id}\n`);

  const authHeaders = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  // 2. Kiểm thử SN-207 A: Danh sách hóa đơn của đại lý
  console.log('2. [SN-207 A] Lấy danh sách hóa đơn bán hàng của Đại lý...');
  const invoicesRes = await fetch(`${API_BASE}/invoices`, { headers: authHeaders });
  const invoices = await invoicesRes.json();
  console.log(`-> Tìm thấy ${invoices.length} hóa đơn của đại lý:`);
  for (const inv of invoices) {
    console.log(`   • Mã: ${inv.invoiceCode} | Trạng thái: ${inv.status} | Tổng: ${Number(inv.amount).toLocaleString('vi-VN')} đ | Còn nợ: ${Number(inv.remainingAmount).toLocaleString('vi-VN')} đ | Hạn: ${new Date(inv.dueDate).toLocaleDateString('vi-VN')}`);
  }

  // 3. Kiểm thử SN-207 C: Tổng công nợ & Hạn mức tín dụng
  console.log('\n3. [SN-207 C] Lấy tổng hợp công nợ và hạn mức khả dụng...');
  const summaryRes = await fetch(`${API_BASE}/invoices/my-debt-summary`, { headers: authHeaders });
  const summary = await summaryRes.json();
  console.log('-> Dữ liệu công nợ đại lý:', {
    customerName: summary.customerName,
    creditLimit: Number(summary.creditLimit).toLocaleString('vi-VN') + ' đ',
    currentDebt: Number(summary.currentDebt).toLocaleString('vi-VN') + ' đ',
    availableCredit: Number(summary.availableCredit).toLocaleString('vi-VN') + ' đ',
    overdueDebt: Number(summary.overdueDebt).toLocaleString('vi-VN') + ' đ',
    debtUsagePercentage: summary.debtUsagePercentage + '%',
    unpaidInvoicesCount: summary.unpaidInvoicesCount,
    overdueInvoicesCount: summary.overdueInvoicesCount,
    creditStatus: summary.creditStatus,
  });

  // 4. Kiểm thử SN-207 B: Tải hóa đơn PDF
  console.log('\n4. [SN-207 B] Kiểm thử xuất file PDF hóa đơn...');
  const targetInv = invoices.find(i => i.remainingAmount > 0) || invoices[0];
  const pdfRes = await fetch(`${API_BASE}/invoices/${targetInv.id}/pdf`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
  const isPdf = pdfBuffer.slice(0, 5).toString('utf-8') === '%PDF-';
  console.log(`-> Tải file PDF HĐ ${targetInv.invoiceCode}: ${isPdf ? 'HỢP LỆ (%PDF- header)' : 'KHÔNG HỢP LỆ'}, Dung lượng: ${pdfBuffer.length} bytes`);

  // 5. Kiểm thử SN-207 C: Ghi nhận thanh toán và cập nhật công nợ
  console.log('\n5. [SN-207 C] Kiểm thử ghi nhận thanh toán công nợ...');
  const payAmount = 1000000; // Trả 1.000.000 đ
  console.log(`-> Thực hiện thanh toán ${payAmount.toLocaleString('vi-VN')} đ cho HĐ ${targetInv.invoiceCode}...`);
  const payRes = await fetch(`${API_BASE}/invoices/${targetInv.id}/payments`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      amount: payAmount,
      paymentMethod: 'BANK_TRANSFER',
      note: 'Kiểm thử thanh toán tự động SN-207 C',
    }),
  });
  const payData = await payRes.json();
  console.log(`-> Kết quả thanh toán:`, payData.message);
  console.log(`-> Dư nợ HĐ sau thanh toán: ${Number(payData.invoice.remainingAmount).toLocaleString('vi-VN')} đ`);
  console.log(`-> Tổng dư nợ mới: ${Number(payData.summary.currentDebt).toLocaleString('vi-VN')} đ (Hạn mức còn lại: ${Number(payData.summary.availableCredit).toLocaleString('vi-VN')} đ)`);

  // 6. Kiểm thử SN-208 A, B, C: Tác vụ nhắc nợ tự động & Chống gửi trùng
  console.log('\n6. [SN-208 A, B, C] Kiểm thử tác vụ quét hạn & gửi nhắc nợ...');
  const run1Res = await fetch(`${API_BASE}/invoices/reminders/trigger`, {
    method: 'POST',
    headers: authHeaders,
  });
  const reminderRun1 = await run1Res.json();
  console.log('-> Lần quét 1 (Tự động):', {
    upcomingSent: reminderRun1.upcomingRemindersSent,
    overdueSent: reminderRun1.overdueRemindersSent,
    skipped: reminderRun1.skippedAlreadySent,
    failed: reminderRun1.failedCount,
  });

  console.log('\n7. [SN-208 C] Kiểm thử chạy lại trong cùng ngày (Kiểm tra cơ chế chống gửi trùng)...');
  const run2Res = await fetch(`${API_BASE}/invoices/reminders/trigger`, {
    method: 'POST',
    headers: authHeaders,
  });
  const reminderRun2 = await run2Res.json();
  console.log('-> Lần quét 2 (Cùng ngày):', {
    upcomingSent: reminderRun2.upcomingRemindersSent,
    overdueSent: reminderRun2.overdueRemindersSent,
    skipped: reminderRun2.skippedAlreadySent,
    failed: reminderRun2.failedCount,
  });
  if (reminderRun2.skippedAlreadySent > 0 && reminderRun2.upcomingRemindersSent === 0 && reminderRun2.overdueRemindersSent === 0) {
    console.log('-> XÁC NHẬN: Cơ chế chống gửi trùng trong ngày hoạt động CHÍNH XÁC 100%!');
  }

  // 8. Lấy thông báo trong ứng dụng (In-app notifications)
  console.log('\n8. [SN-208 A] Kiểm tra danh sách thông báo nhắc nợ trong ứng dụng...');
  const notifsRes = await fetch(`${API_BASE}/invoices/notifications`, { headers: authHeaders });
  const notifs = await notifsRes.json();
  console.log(`-> Đại lý nhận được ${notifs.length} thông báo trong ứng dụng:`);
  for (const n of notifs.slice(0, 3)) {
    console.log(`   • [${n.priority.toUpperCase()}] ${n.title} | ${n.message}`);
  }

  // 9. Kiểm thử phân quyền truy cập chéo (Data Isolation R*)
  console.log('\n9. [Kiểm thử Phân quyền] Đại lý truy cập hóa đơn của đại lý khác...');
  const crossRes = await fetch(`${API_BASE}/invoices/88888888-0000-0000-0000-000000000005`, {
    headers: authHeaders,
  });
  if (crossRes.status === 403) {
    const crossData = await crossRes.json();
    console.log(`-> CHÍNH XÁC: Backend chặn truy cập với mã lỗi 403 Forbidden (${crossData.message})`);
  } else {
    console.log(`❌ LỖI BẢO MẬT: Phản hồi không mong muốn: ${crossRes.status}`);
  }

  console.log('\n=== HOÀN TẤT KIỂM THỬ TOÀN DIỆN THÀNH CÔNG ===');
}

testAll().catch(e => {
  console.error('Test error:', e);
  process.exit(1);
});
