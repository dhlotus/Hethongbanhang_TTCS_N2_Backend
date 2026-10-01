-- =============================================================================
-- Migration 007: Stored Procedures, Functions, Triggers & Tối ưu hóa Ràng buộc
-- Hệ thống: LOHA SALES - Quản lý Bán hàng & Kho Doanh nghiệp B2B
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. HÀM & TRIGGER TỰ ĐỘNG CẬP NHẬT UPDATED_AT CHO TẤT CẢ CÁC BẢNG
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Gán Trigger cho từng bảng quản lý dữ liệu
DO $$
DECLARE
    tbl text;
    tables text[] := ARRAY[
        'roles', 'users', 'categories', 'suppliers', 'products', 'product_units',
        'price_lists', 'price_list_items', 'discounts', 'customers',
        'customer_shipping_addresses', 'warehouses', 'warehouse_locations',
        'inventories', 'inventory_batches', 'goods_receipts', 'goods_issues',
        'orders', 'invoices', 'payments', 'return_orders'
    ];
BEGIN
    FOREACH tbl IN ARRAY tables LOOP
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = tbl) THEN
            EXECUTE format('DROP TRIGGER IF EXISTS trg_set_updated_at ON %I;', tbl);
            EXECUTE format('CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();', tbl);
        END IF;
    END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 2. HÀM TÍNH TOÁN NHÓM TUỔI NỢ (AGING BUCKET)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_calculate_aging_bucket(p_due_date DATE)
RETURNS VARCHAR(30) AS $$
DECLARE
    v_days_overdue INT;
BEGIN
    IF p_due_date IS NULL OR CURRENT_DATE <= p_due_date THEN
        RETURN 'CURRENT';
    END IF;

    v_days_overdue := CURRENT_DATE - p_due_date;

    IF v_days_overdue <= 30 THEN
        RETURN '1_30_DAYS';
    ELSIF v_days_overdue <= 60 THEN
        RETURN '31_60_DAYS';
    ELSIF v_days_overdue <= 90 THEN
        RETURN '61_90_DAYS';
    ELSE
        RETURN 'OVER_90_DAYS';
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION fn_calculate_aging_bucket(DATE) IS 'Tự động phân loại nhóm tuổi nợ phục vụ báo cáo và cảnh báo khóa nợ (EP-08)';

-- -----------------------------------------------------------------------------
-- 3. HÀM GIỮ CHỖ TỒN KHO AN TOÀN TRÁNH ÂM KHO (ACID TRANSACTION + SELECT FOR UPDATE)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_allocate_inventory_for_order(p_order_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_order RECORD;
    v_item RECORD;
    v_current_on_hand NUMERIC(15, 2);
    v_current_allocated NUMERIC(15, 2);
    v_sku_name VARCHAR(255);
BEGIN
    -- 1. Khóa và lấy thông tin đơn hàng
    SELECT id, code, warehouse_id, status
    INTO v_order
    FROM orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Không tìm thấy đơn hàng với ID: %', p_order_id;
    END IF;

    IF v_order.status NOT IN ('DRAFT', 'APPROVED', 'PENDING_APPROVAL') THEN
        RAISE EXCEPTION 'Đơn hàng % đang ở trạng thái %, không thể thực hiện giữ chỗ tồn kho.', v_order.code, v_order.status;
    END IF;

    IF v_order.warehouse_id IS NULL THEN
        RAISE EXCEPTION 'Đơn hàng % chưa được chỉ định kho xuất hàng.', v_order.code;
    END IF;

    -- 2. Duyệt từng mặt hàng trong đơn hàng và khóa dòng hàng trong bảng inventories bằng SELECT ... FOR UPDATE
    FOR v_item IN
        SELECT oi.product_id, oi.base_quantity, p.name AS product_name, p.sku
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = p_order_id
    LOOP
        -- Khóa dòng tồn kho của SKU tại kho chỉ định để chống tranh chấp đồng thời
        SELECT on_hand, allocated
        INTO v_current_on_hand, v_current_allocated
        FROM inventories
        WHERE warehouse_id = v_order.warehouse_id AND product_id = v_item.product_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Sản phẩm % (SKU: %) chưa được khởi tạo tồn kho tại kho được chỉ định.', v_item.product_name, v_item.sku;
        END IF;

        -- Kiểm tra số lượng tồn khả dụng (on_hand - allocated)
        IF (v_current_on_hand - v_current_allocated) < v_item.base_quantity THEN
            RAISE EXCEPTION 'Không đủ tồn khả dụng cho sản phẩm % (SKU: %). Tồn khả dụng hiện tại: %, Cần giữ chỗ: %',
                v_item.product_name, v_item.sku, (v_current_on_hand - v_current_allocated), v_item.base_quantity;
        END IF;

        -- Cập nhật lượng giữ chỗ (allocated)
        UPDATE inventories
        SET allocated = allocated + v_item.base_quantity,
            updated_at = CURRENT_TIMESTAMP
        WHERE warehouse_id = v_order.warehouse_id AND product_id = v_item.product_id;
    END LOOP;

    -- 3. Cập nhật trạng thái đơn hàng sang ALLOCATED
    UPDATE orders
    SET status = 'ALLOCATED',
        updated_at = CURRENT_TIMESTAMP
    WHERE id = p_order_id;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_allocate_inventory_for_order(UUID) IS 'Khóa và giữ chỗ tồn kho (allocated) cho đơn hàng với SELECT ... FOR UPDATE chống âm tồn (EP-04, EP-05)';

-- -----------------------------------------------------------------------------
-- 4. HÀM GIẢI PHÓNG TỒN KHO GIỮ CHỖ (KHI HỦY HOẶC TỪ CHỐI ĐƠN HÀNG)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_release_inventory_allocation(p_order_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_order RECORD;
    v_item RECORD;
BEGIN
    SELECT id, code, warehouse_id, status
    INTO v_order
    FROM orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Không tìm thấy đơn hàng với ID: %', p_order_id;
    END IF;

    -- Chỉ giải phóng nếu đơn hàng đã được giữ chỗ (ALLOCATED, PICKING...)
    IF v_order.status IN ('ALLOCATED', 'PICKING') THEN
        FOR v_item IN
            SELECT product_id, base_quantity
            FROM order_items
            WHERE order_id = p_order_id
        LOOP
            UPDATE inventories
            SET allocated = GREATEST(0, allocated - v_item.base_quantity),
                updated_at = CURRENT_TIMESTAMP
            WHERE warehouse_id = v_order.warehouse_id AND product_id = v_item.product_id;
        END LOOP;
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_release_inventory_allocation(UUID) IS 'Giải phóng lượng tồn đã giữ chỗ khi đơn hàng bị hủy hoặc từ chối (EP-04, EP-05)';

-- -----------------------------------------------------------------------------
-- 5. HÀM XÁC NHẬN XUẤT KHO VÀ GHI SỔ THẺ KHO (GOODS ISSUE CONFIRMATION)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_confirm_goods_issue(p_goods_issue_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_issue RECORD;
    v_item RECORD;
    v_new_balance NUMERIC(15, 2);
BEGIN
    -- 1. Khóa và lấy thông tin phiếu xuất kho
    SELECT id, code, order_id, warehouse_id, status
    INTO v_issue
    FROM goods_issues
    WHERE id = p_goods_issue_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Không tìm thấy phiếu xuất kho với ID: %', p_goods_issue_id;
    END IF;

    IF v_issue.status = 'DELIVERED' THEN
        RAISE EXCEPTION 'Phiếu xuất kho % đã được xác nhận hoàn tất trước đó.', v_issue.code;
    END IF;

    -- 2. Duyệt từng dòng xuất kho để trừ tồn thực tế và trừ tồn giữ chỗ
    FOR v_item IN
        SELECT gii.product_id, gii.batch_id, gii.base_quantity, gii.unit_price, p.sku
        FROM goods_issue_items gii
        JOIN products p ON gii.product_id = p.id
        WHERE gii.issue_id = p_goods_issue_id
    LOOP
        -- Khóa và cập nhật tồn kho tổng hợp
        UPDATE inventories
        SET on_hand = on_hand - v_item.base_quantity,
            allocated = GREATEST(0, allocated - v_item.base_quantity),
            updated_at = CURRENT_TIMESTAMP
        WHERE warehouse_id = v_issue.warehouse_id AND product_id = v_item.product_id
        RETURNING on_hand INTO v_new_balance;

        -- Khóa và cập nhật tồn theo Lô (FEFO) nếu có quản lý lô
        IF v_item.batch_id IS NOT NULL THEN
            UPDATE inventory_batches
            SET quantity = quantity - v_item.base_quantity,
                allocated_quantity = GREATEST(0, allocated_quantity - v_item.base_quantity),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = v_item.batch_id;
        END IF;

        -- Ghi sổ thẻ kho (Audit Ledger - Thẻ kho bất biến)
        INSERT INTO inventory_transactions (
            warehouse_id, product_id, batch_id, transaction_type,
            quantity_change, balance_after, unit_cost, reference_type,
            reference_id, notes, created_by
        ) VALUES (
            v_issue.warehouse_id, v_item.product_id, v_item.batch_id, 'EXPORT',
            -v_item.base_quantity, v_new_balance, v_item.unit_price, 'GOODS_ISSUE',
            v_issue.code, 'Xuất kho giao hàng theo đơn ' || COALESCE(v_issue.order_id::text, ''), p_user_id
        );
    END LOOP;

    -- 3. Cập nhật trạng thái phiếu xuất kho và đơn hàng
    UPDATE goods_issues
    SET status = 'DELIVERED',
        delivered_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = p_goods_issue_id;

    IF v_issue.order_id IS NOT NULL THEN
        UPDATE orders
        SET status = 'DELIVERED',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = v_issue.order_id;
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_confirm_goods_issue(UUID, UUID) IS 'Trừ tồn kho on_hand và allocated đồng thời ghi thẻ kho khi xuất kho giao hàng (EP-05, EP-06)';

-- -----------------------------------------------------------------------------
-- 6. HÀM KIỂM TRA HẠN MỨC CÔNG NỢ & NỢ QUÁ HẠN ĐỂ CẢNH BÁO / DUYỆT / KHÓA BÁN
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_check_customer_credit(
    p_customer_id UUID,
    p_new_order_amount NUMERIC(15, 2),
    OUT is_exceeded_limit BOOLEAN,
    OUT is_overdue BOOLEAN,
    OUT overdue_days INT,
    OUT current_debt NUMERIC(15, 2),
    OUT credit_limit NUMERIC(15, 2),
    OUT warning_message TEXT
) AS $$
DECLARE
    v_cust RECORD;
    v_max_overdue_days INT := 0;
BEGIN
    -- Lấy thông tin đại lý
    SELECT id, code, name, credit_limit, current_debt, max_debt_days, status
    INTO v_cust
    FROM customers
    WHERE id = p_customer_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Không tìm thấy thông tin đại lý với ID: %', p_customer_id;
    END IF;

    current_debt := v_cust.current_debt;
    credit_limit := v_cust.credit_limit;

    -- Kiểm tra vượt hạn mức tiền
    IF (v_cust.current_debt + p_new_order_amount) > v_cust.credit_limit THEN
        is_exceeded_limit := TRUE;
    ELSE
        is_exceeded_limit := FALSE;
    END IF;

    -- Kiểm tra nợ quá hạn từ các hóa đơn chưa trả hết
    SELECT COALESCE(MAX(CURRENT_DATE - due_date), 0)
    INTO v_max_overdue_days
    FROM invoices
    WHERE customer_id = p_customer_id
      AND payment_status IN ('UNPAID', 'PARTIAL', 'OVERDUE')
      AND due_date < CURRENT_DATE;

    overdue_days := v_max_overdue_days;

    IF v_max_overdue_days > v_cust.max_debt_days THEN
        is_overdue := TRUE;
    ELSE
        is_overdue := FALSE;
    END IF;

    -- Tạo chuỗi thông báo cảnh báo
    IF is_exceeded_limit AND is_overdue THEN
        warning_message := format('Đại lý vượt hạn mức công nợ (%s / %s) và có hóa đơn quá hạn %s ngày (tối đa cho phép %s ngày). Đơn hàng bắt buộc phải qua phê duyệt.',
            (v_cust.current_debt + p_new_order_amount), v_cust.credit_limit, v_max_overdue_days, v_cust.max_debt_days);
    ELSIF is_exceeded_limit THEN
        warning_message := format('Đơn hàng làm vượt hạn mức công nợ của đại lý (Dư nợ mới: %s, Hạn mức: %s). Bắt buộc phải qua phê duyệt của Kế toán.',
            (v_cust.current_debt + p_new_order_amount), v_cust.credit_limit);
    ELSIF is_overdue THEN
        warning_message := format('Đại lý có hóa đơn nợ quá hạn %s ngày (tối đa cho phép %s ngày). Bắt buộc phải thanh toán hoặc qua phê duyệt.',
            v_max_overdue_days, v_cust.max_debt_days);
    ELSE
        warning_message := 'Hạn mức công nợ và thời hạn nợ hợp lệ.';
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION fn_check_customer_credit(UUID, NUMERIC) IS 'Kiểm tra hạn mức tín dụng và số ngày nợ quá hạn của đại lý (EP-03, EP-04, EP-08)';
