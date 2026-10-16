/**
 * Tiện ích chuyển đổi số tiền thành chữ Tiếng Việt chuẩn hóa kế toán (VND)
 */

const DIGITS = [
  'không',
  'một',
  'hai',
  'ba',
  'bốn',
  'năm',
  'sáu',
  'bảy',
  'tám',
  'chín',
];

const SCALES = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ'];

function readThreeDigits(threeDigits: number, showZeroHundred: boolean): string {
  const hundred = Math.floor(threeDigits / 100);
  const remainder = threeDigits % 100;
  const ten = Math.floor(remainder / 10);
  const unit = remainder % 10;

  const result: string[] = [];

  if (hundred > 0 || showZeroHundred) {
    result.push(`${DIGITS[hundred]} trăm`);
  }

  if (ten > 1) {
    result.push(`${DIGITS[ten]} mươi`);
    if (unit === 1) {
      result.push('mốt');
    } else if (unit === 5) {
      result.push('lăm');
    } else if (unit > 0) {
      result.push(DIGITS[unit]);
    }
  } else if (ten === 1) {
    result.push('mười');
    if (unit === 5) {
      result.push('lăm');
    } else if (unit > 0) {
      result.push(DIGITS[unit]);
    }
  } else if (ten === 0 && unit > 0) {
    if (hundred > 0 || showZeroHundred) {
      result.push('lẻ');
    }
    result.push(DIGITS[unit]);
  }

  return result.join(' ');
}

export function numberToVietnameseWords(amount: number): string {
  if (isNaN(amount) || amount === 0) {
    return 'Không đồng chẵn';
  }

  let num = Math.abs(Math.round(amount));
  const groups: number[] = [];

  while (num > 0) {
    groups.push(num % 1000);
    num = Math.floor(num / 1000);
  }

  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const val = groups[i];
    if (val > 0) {
      const showZeroHundred = i < groups.length - 1;
      const text = readThreeDigits(val, showZeroHundred);
      const scale = SCALES[i];
      parts.push(scale ? `${text} ${scale}` : text);
    }
  }

  const raw = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (!raw) return 'Không đồng chẵn';

  const capitalized = raw.charAt(0).toUpperCase() + raw.slice(1);
  return `${capitalized} đồng chẵn`;
}
