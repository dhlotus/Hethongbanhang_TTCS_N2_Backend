/**
 * Tiện ích xử lý chuỗi tiếng Việt và tìm kiếm không dấu
 */

/**
 * Chuyển đổi chuỗi tiếng Việt có dấu thành không dấu
 * Hỗ trợ Unicode dựng sẵn (precomposed) và tổ hợp (decomposed), ký tự đ/Đ
 */
export function removeVietnameseTones(str: string): string {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

/**
 * So sánh tìm kiếm chuỗi linh hoạt: hỗ trợ cả tìm kiếm có dấu và không dấu
 * @param target Chuỗi gốc cần tìm (ví dụ: tên đại lý, địa chỉ)
 * @param term Từ khóa tìm kiếm người dùng nhập
 */
export function matchesSearchTerm(
  target: string | undefined | null,
  term: string | undefined | null,
): boolean {
  if (!target || !term) return false;
  const lowerTarget = target.toLowerCase();
  const lowerTerm = term.toLowerCase().trim();
  if (!lowerTerm) return true;

  // 1. Khớp chuỗi trực tiếp (có dấu hoặc không dấu nguyên bản)
  if (lowerTarget.includes(lowerTerm)) {
    return true;
  }

  // 2. Khớp chuỗi không dấu
  const normTarget = removeVietnameseTones(target);
  const normTerm = removeVietnameseTones(term);
  return normTarget.includes(normTerm);
}
