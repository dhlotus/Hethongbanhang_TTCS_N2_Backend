import * as fs from 'fs';
import * as path from 'path';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UserRole } from '../src/common/enums/user-role.enum';
import {
  AVATAR_MESSAGES,
  MAX_AVATAR_SIZE,
} from '../src/modules/users/constants/avatar.constant';
import { AvatarValidationPipe } from '../src/modules/users/pipes/avatar-validation.pipe';
import { UsersService } from '../src/modules/users/users.service';
import { UsersController } from '../src/modules/users/users.controller';
import { AuthController } from '../src/modules/auth/auth.controller';
import { AuthService } from '../src/modules/auth/auth.service';
import { JwtService } from '@nestjs/jwt';
import { jwtConfig } from '../src/config/jwt.config';
import { ICurrentUser } from '../src/modules/auth/interfaces/current-user.interface';

// Helper mock file creator
function createMockFile(options: {
  fieldname?: string;
  originalname?: string;
  mimetype?: string;
  size?: number;
  content?: string;
}): Express.Multer.File {
  const content = options.content ?? 'mock image content';
  const buffer = Buffer.from(content);
  return {
    fieldname: options.fieldname ?? 'file',
    originalname: options.originalname ?? 'avatar.png',
    encoding: '7bit',
    mimetype: options.mimetype ?? 'image/png',
    size: options.size ?? buffer.length,
    buffer: options.size ? Buffer.alloc(options.size) : buffer,
    destination: '',
    filename: '',
    path: '',
    stream: null as unknown as Express.Multer.File['stream'],
  };
}

async function runTests(): Promise<void> {
  console.log('=== BẮT ĐẦU KIỂM THỬ TÍCH HỢP SN-144: API UPLOAD ẢNH ĐẠI DIỆN ===\n');
  let passedCount = 0;
  let failedCount = 0;

  function assert(condition: boolean, testName: string): void {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passedCount++;
    } else {
      console.error(`  ❌ FAIL: ${testName}`);
      failedCount++;
    }
  }

  const validationPipe = new AvatarValidationPipe();
  const usersService = new UsersService();
  await usersService.onModuleInit();

  const jwtService = new JwtService({
    secret: jwtConfig.secret,
    signOptions: { expiresIn: jwtConfig.expiresIn },
  });
  const authService = new AuthService(usersService, jwtService);
  const usersController = new UsersController(usersService);
  const authController = new AuthController(authService, usersService);

  // --------------------------------------------------------------------------
  // Nhóm 1: Kiểm thử AvatarValidationPipe (Khai báo, Dung lượng & Định dạng)
  // --------------------------------------------------------------------------
  console.log('--- 1. Kiểm thử AvatarValidationPipe ---');

  // 1.1 Kiểm tra file bị thiếu
  try {
    validationPipe.transform(undefined);
    assert(false, 'Phải ném BadRequestException khi không gửi file');
  } catch (error) {
    assert(
      error instanceof BadRequestException &&
        error.message === AVATAR_MESSAGES.FILE_REQUIRED,
      'Ném BadRequestException khi thiếu file: "Vui lòng chọn file ảnh để tải lên."',
    );
  }

  // 1.2 Kiểm tra file sai định dạng (PDF, GIF, TXT)
  const invalidFiles = [
    createMockFile({ originalname: 'document.pdf', mimetype: 'application/pdf' }),
    createMockFile({ originalname: 'animation.gif', mimetype: 'image/gif' }),
    createMockFile({ originalname: 'avatar.exe', mimetype: 'application/octet-stream' }),
    createMockFile({ originalname: 'fake.png', mimetype: 'text/plain' }),
    createMockFile({ originalname: 'fake.txt', mimetype: 'image/png' }),
  ];

  for (const invFile of invalidFiles) {
    try {
      validationPipe.transform(invFile);
      assert(false, `Phải ném BadRequestException cho file sai định dạng: ${invFile.originalname}`);
    } catch (error) {
      assert(
        error instanceof BadRequestException &&
          error.message === AVATAR_MESSAGES.INVALID_FILE_TYPE,
        `Chặn file không hợp lệ (${invFile.originalname} / ${invFile.mimetype}): "Chỉ chấp nhận file ảnh định dạng JPG hoặc PNG"`,
      );
    }
  }

  // 1.3 Kiểm tra file vượt quá 2MB (2,097,152 bytes)
  const oversizedFile = createMockFile({
    originalname: 'large-photo.jpg',
    mimetype: 'image/jpeg',
    size: MAX_AVATAR_SIZE + 1, // 2MB + 1 byte
  });

  try {
    validationPipe.transform(oversizedFile);
    assert(false, 'Phải ném BadRequestException khi dung lượng vượt quá 2MB');
  } catch (error) {
    assert(
      error instanceof BadRequestException &&
        error.message === AVATAR_MESSAGES.FILE_TOO_LARGE,
      'Chặn file vượt quá 2MB: "Dung lượng ảnh không được vượt quá 2MB"',
    );
  }

  // 1.4 Kiểm tra file JPG và PNG hợp lệ
  const validJpg = createMockFile({
    originalname: 'my-avatar.jpg',
    mimetype: 'image/jpeg',
    size: 500 * 1024, // 500KB
  });
  const validPng = createMockFile({
    originalname: 'profile.png',
    mimetype: 'image/png',
    size: 1.5 * 1024 * 1024, // 1.5MB
  });

  try {
    const resJpg = validationPipe.transform(validJpg);
    assert(resJpg === validJpg, 'Chấp nhận file JPG hợp lệ <= 2MB');
    const resPng = validationPipe.transform(validPng);
    assert(resPng === validPng, 'Chấp nhận file PNG hợp lệ <= 2MB');
  } catch (e) {
    assert(false, `Không được ném ngoại lệ với file hợp lệ: ${e}`);
  }

  // --------------------------------------------------------------------------
  // Nhóm 2: Kiểm thử UsersService.uploadAvatar (Lưu trữ đĩa & Xóa avatar cũ)
  // --------------------------------------------------------------------------
  console.log('\n--- 2. Kiểm thử UsersService.uploadAvatar ---');

  const testUserId = 'usr-admin-001';
  const mockFile1 = createMockFile({
    originalname: 'avatar-test-1.png',
    mimetype: 'image/png',
    content: 'First avatar image content buffer',
  });

  const uploadResult1 = await usersService.uploadAvatar(testUserId, mockFile1);

  assert(
    uploadResult1.statusCode === 200 &&
      uploadResult1.message === 'Cập nhật ảnh đại diện thành công' &&
      uploadResult1.data.avatarUrl.startsWith('/uploads/avatars/avatar-usr-admin-001-'),
    'Upload avatar lần 1 thành công, trả về avatarUrl đúng format /uploads/avatars/...',
  );

  const savedFilePath1 = path.join(
    process.cwd(),
    uploadResult1.data.avatarUrl.replace(/^\//, ''),
  );
  assert(fs.existsSync(savedFilePath1), 'File ảnh mới đã được lưu thành công trên ổ đĩa');

  // Kiểm tra entity và toSafeUser
  const safeUserAfter1 = await usersService.findSafeById(testUserId);
  assert(
    safeUserAfter1.avatarUrl === uploadResult1.data.avatarUrl,
    'Trường avatarUrl trong UserEntity và SafeUser đã được cập nhật chính xác',
  );

  // 2.2 Upload avatar lần 2: Đảm bảo file cũ 1 bị xóa khỏi đĩa để tránh rác ổ đĩa
  const mockFile2 = createMockFile({
    originalname: 'avatar-test-2.jpg',
    mimetype: 'image/jpeg',
    content: 'Second avatar image replacement buffer',
  });

  const uploadResult2 = await usersService.uploadAvatar(testUserId, mockFile2);
  const savedFilePath2 = path.join(
    process.cwd(),
    uploadResult2.data.avatarUrl.replace(/^\//, ''),
  );

  assert(
    uploadResult2.data.avatarUrl !== uploadResult1.data.avatarUrl,
    'Avatar mới có đường dẫn khác với avatar cũ (tên file sinh ngẫu nhiên tránh cache/lộ tên gốc)',
  );
  assert(fs.existsSync(savedFilePath2), 'File ảnh mới lần 2 đã lưu trên đĩa');
  assert(!fs.existsSync(savedFilePath1), 'File ảnh cũ lần 1 đã được xóa tự động khỏi ổ đĩa server');

  // 2.3 Upload cho user không tồn tại -> ném NotFoundException
  try {
    await usersService.uploadAvatar('non-existent-user-id', mockFile2);
    assert(false, 'Phải ném NotFoundException khi user không tồn tại');
  } catch (error) {
    assert(
      error instanceof NotFoundException,
      'Ném NotFoundException khi userId không tồn tại',
    );
  }

  // --------------------------------------------------------------------------
  // Nhóm 3: Kiểm thử UsersService.removeAvatar
  // --------------------------------------------------------------------------
  console.log('\n--- 3. Kiểm thử UsersService.removeAvatar ---');

  const userAfterRemove = await usersService.removeAvatar(testUserId);
  assert(userAfterRemove.avatarUrl === null, 'Xóa avatar: Trường avatarUrl chuyển về null');
  assert(!fs.existsSync(savedFilePath2), 'Xóa avatar: File ảnh trên đĩa đã được xóa sạch');

  // --------------------------------------------------------------------------
  // Nhóm 4: Kiểm thử UsersController & AuthController Integration
  // --------------------------------------------------------------------------
  console.log('\n--- 4. Kiểm thử UsersController & AuthController Integration ---');

  const mockCurrentUser: ICurrentUser = {
    userId: 'usr-sales-002',
    email: 'sales@loha.vn',
    roles: [UserRole.SALES_REP],
    username: 'sales',
  };

  const salesMockFile = createMockFile({
    originalname: 'sales-avatar.png',
    mimetype: 'image/png',
    content: 'Sales Rep avatar binary content',
  });

  // Gọi qua UsersController.uploadAvatar (POST /api/users/me/avatar)
  const controllerRes1 = await usersController.uploadAvatar(
    mockCurrentUser,
    salesMockFile,
  );

  assert(
    controllerRes1.statusCode === 200 &&
      controllerRes1.message === 'Cập nhật ảnh đại diện thành công' &&
      controllerRes1.data.avatarUrl.includes('usr-sales-002'),
    'UsersController.uploadAvatar xử lý thành công cho người dùng SALES_REP (RBAC hợp lệ)',
  );

  // Dọn dẹp file test
  await usersService.removeAvatar(mockCurrentUser.userId);

  // Gọi qua AuthController.uploadAvatar (POST /api/auth/avatar)
  const controllerRes2 = await authController.uploadAvatar(
    mockCurrentUser,
    salesMockFile,
  );

  assert(
    controllerRes2.statusCode === 200 &&
      controllerRes2.message === 'Cập nhật ảnh đại diện thành công' &&
      controllerRes2.data.avatarUrl.includes('usr-sales-002'),
    'AuthController.uploadAvatar xử lý thành công qua endpoint /auth/avatar',
  );

  // Dọn dẹp file test cuối cùng
  await usersService.removeAvatar(mockCurrentUser.userId);

  console.log('\n=============================================================');
  console.log(`TỔNG KẾT KIỂM THỬ SN-144: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log('=============================================================');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Lỗi thực thi kiểm thử:', err);
  process.exit(1);
});
