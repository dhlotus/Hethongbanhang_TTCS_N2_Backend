import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateSupplierDto } from '../src/modules/suppliers/dto/create-supplier.dto';

describe('CreateSupplierDto Validation (SN-25)', () => {
  it('should pass with valid data (taxCode 12 digits, valid phone and contactName)', async () => {
    const raw = {
      name: 'Công ty Cổ phần Nước giải khát LOHA',
      taxCode: '031234567890',
      contactName: 'Đỗ Quốc Tuấn',
      phone: '0901234567',
    };
    const dto = plainToInstance(CreateSupplierDto, raw);
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should reject taxCode if not exactly 12 digits (contains letters)', async () => {
    const raw = {
      name: 'NCC Test',
      taxCode: '03123456789A',
    };
    const dto = plainToInstance(CreateSupplierDto, raw);
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const taxError = errors.find((e) => e.property === 'taxCode');
    expect(taxError).toBeDefined();
    expect(Object.values(taxError!.constraints || {})).toContain(
      'Mã số thuế phải bao gồm đúng 12 chữ số',
    );
  });

  it('should reject taxCode if length is not 12 digits', async () => {
    const rawShort = {
      name: 'NCC Test',
      taxCode: '0312345678', // 10 digits
    };
    const dto = plainToInstance(CreateSupplierDto, rawShort);
    const errors = await validate(dto);
    const taxError = errors.find((e) => e.property === 'taxCode');
    expect(taxError).toBeDefined();
    expect(Object.values(taxError!.constraints || {})).toContain(
      'Mã số thuế phải bao gồm đúng 12 chữ số',
    );
  });

  it('should reject contactName with numbers', async () => {
    const raw = {
      name: 'NCC Test',
      contactName: 'Nguyễn Văn A 123',
    };
    const dto = plainToInstance(CreateSupplierDto, raw);
    const errors = await validate(dto);
    const contactError = errors.find((e) => e.property === 'contactName');
    expect(contactError).toBeDefined();
    expect(Object.values(contactError!.constraints || {})).toContain(
      'Tên người liên hệ không được chứa chữ số',
    );
  });

  it('should reject phone not starting with 0', async () => {
    const raw = {
      name: 'NCC Test',
      phone: '1900156000',
    };
    const dto = plainToInstance(CreateSupplierDto, raw);
    const errors = await validate(dto);
    const phoneError = errors.find((e) => e.property === 'phone');
    expect(phoneError).toBeDefined();
    expect(Object.values(phoneError!.constraints || {})).toContain(
      'Số điện thoại phải bắt đầu bằng số 0',
    );
  });

  it('should reject phone with length < 10 or > 12', async () => {
    const rawShort = {
      name: 'NCC Test',
      phone: '0901234',
    };
    const dtoShort = plainToInstance(CreateSupplierDto, rawShort);
    const errorsShort = await validate(dtoShort);
    const phoneShortError = errorsShort.find((e) => e.property === 'phone');
    expect(phoneShortError).toBeDefined();
    expect(Object.values(phoneShortError!.constraints || {})).toContain(
      'Số điện thoại phải từ 10 đến 12 chữ số',
    );

    const rawLong = {
      name: 'NCC Test',
      phone: '09012345678901',
    };
    const dtoLong = plainToInstance(CreateSupplierDto, rawLong);
    const errorsLong = await validate(dtoLong);
    const phoneLongError = errorsLong.find((e) => e.property === 'phone');
    expect(phoneLongError).toBeDefined();
    expect(Object.values(phoneLongError!.constraints || {})).toContain(
      'Số điện thoại phải từ 10 đến 12 chữ số',
    );
  });
});
