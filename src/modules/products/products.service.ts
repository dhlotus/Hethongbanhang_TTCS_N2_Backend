import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductEntity } from './entities/product.entity';
import { ImportProductItemDto, PreviewImportResult, ConfirmImportResult } from './dto/import-product.dto';
import * as ExcelJS from 'exceljs';
import { Response } from 'express';


@Injectable()
export class ProductsService implements OnModuleInit {
  private products = new Map<string, ProductEntity>();

  constructor() {
    this.seedInitialProducts();
  }

  onModuleInit(): void {
    if (this.products.size === 0) {
      this.seedInitialProducts();
    }
  }

  private seedInitialProducts(): void {
    const initialList: Partial<ProductEntity>[] = [
      {
        id: 'prod-001',
        sku: 'LH-MILK-900G',
        name: 'Sữa Bột Dinh Dưỡng Cao Cấp Loha Gold 900g',
        category: 'Sữa Dinh Dưỡng',
        baseUnit: 'Lon',
        price: 520000,
        costPrice: 380000,
        margin: 26.92,
        stockQuantity: 340,
        status: 'ACTIVE',
        barcode: '8936012345011',
        description: 'Dòng sữa dinh dưỡng bổ sung Canxi và DHA cho trẻ nhỏ và người lớn tuổi',
      },
      {
        id: 'prod-002',
        sku: 'LH-NUT-180ML',
        name: 'Sữa Hạt Óc Chó Hạnh Nhân Organic 180ml',
        category: 'Sữa Dinh Dưỡng',
        baseUnit: 'Hộp',
        price: 18000,
        costPrice: 11500,
        margin: 36.11,
        stockQuantity: 1200,
        status: 'ACTIVE',
        barcode: '8936012345028',
        description: 'Sữa hạt thuần chay ít ngọt tốt cho tim mạch',
      },
      {
        id: 'prod-003',
        sku: 'LH-NEST-70ML',
        name: 'Nước Yến Sào Chưng Đường Phèn Loha Nest 70ml',
        category: 'Yến Sào & Bổ Dưỡng',
        baseUnit: 'Hũ',
        price: 65000,
        costPrice: 42000,
        margin: 35.38,
        stockQuantity: 580,
        status: 'ACTIVE',
        barcode: '8936012345035',
        description: 'Tổ yến thiên nhiên chưng đường phèn thanh mát bồi bổ sức khỏe',
      },
      {
        id: 'prod-004',
        sku: 'LH-CEREAL-500G',
        name: 'Ngũ Cốc Dinh Dưỡng Hạt Mầm Loha Meal 500g',
        category: 'Ngũ Cốc Thực Dưỡng',
        baseUnit: 'Túi',
        price: 145000,
        costPrice: 95000,
        margin: 34.48,
        stockQuantity: 410,
        status: 'ACTIVE',
        barcode: '8936012345042',
        description: 'Hỗn hợp 12 loại hạt mầm nướng chín nguyên chất',
      },
      {
        id: 'prod-005',
        sku: 'LH-COLLAGEN-50ML',
        name: 'Nước Uống Collagen Đông Trùng Hạ Thảo 50ml',
        category: 'Thực Phẩm Chức Năng',
        baseUnit: 'Chai',
        price: 85000,
        costPrice: 55000,
        margin: 35.29,
        stockQuantity: 260,
        status: 'ACTIVE',
        barcode: '8936012345059',
        description: 'Collagen thủy phân kết hợp chiết xuất đông trùng hạ thảo tự nhiên',
      },
    ];

    for (const item of initialList) {
      const entity = new ProductEntity(item);
      this.products.set(entity.id, entity);
    }
  }

  async findAll(): Promise<ProductEntity[]> {
    return Array.from(this.products.values());
  }

  async findById(id: string): Promise<ProductEntity> {
    const product =
      this.products.get(id) ||
      Array.from(this.products.values()).find(
        (p) => p.sku.toLowerCase() === id.toLowerCase(),
      );

    if (!product) {
      throw new NotFoundException(`Không tìm thấy sản phẩm có mã hoặc ID: ${id}`);
    }

    return product;
  }

  async create(dto: CreateProductDto): Promise<ProductEntity> {
    const existing = Array.from(this.products.values()).find(
      (p) => p.sku.toLowerCase() === dto.sku.trim().toLowerCase(),
    );

    if (existing) {
      throw new BadRequestException(`Mã SKU "${dto.sku}" đã tồn tại trong hệ thống`);
    }

    const margin =
      dto.price > 0
        ? Number((((dto.price - dto.costPrice) / dto.price) * 100).toFixed(2))
        : 0;

    const newProduct = new ProductEntity({
      id: `prod-${Date.now()}`,
      sku: dto.sku.trim().toUpperCase(),
      name: dto.name.trim(),
      category: dto.category.trim(),
      baseUnit: dto.baseUnit.trim(),
      price: dto.price,
      costPrice: dto.costPrice,
      margin,
      stockQuantity: dto.stockQuantity ?? 0,
      status: 'ACTIVE',
      barcode: dto.barcode,
      description: dto.description,
    });

    this.products.set(newProduct.id, newProduct);
    return newProduct;
  }

  async update(idOrSku: string, dto: Partial<CreateProductDto>): Promise<ProductEntity> {
    const product = await this.findById(idOrSku);
    if (dto.name !== undefined) product.name = dto.name.trim();
    if (dto.category !== undefined) product.category = dto.category.trim();
    if (dto.baseUnit !== undefined) product.baseUnit = dto.baseUnit.trim();
    if (dto.price !== undefined) product.price = Number(dto.price);
    if (dto.costPrice !== undefined) product.costPrice = Number(dto.costPrice);
    if (dto.barcode !== undefined) product.barcode = dto.barcode?.trim();
    if (dto.description !== undefined) product.description = dto.description?.trim();
    if (product.price > 0 && product.costPrice !== undefined) {
      product.margin = Number((((product.price - product.costPrice) / product.price) * 100).toFixed(2));
    }
    product.updatedAt = new Date();
    this.products.set(product.id, product);
    return product;
  }

  async updateStock(idOrSku: string, deltaQuantity: number): Promise<ProductEntity> {
    const product = await this.findById(idOrSku);
    product.stockQuantity += deltaQuantity;
    if (product.stockQuantity < 0) {
      product.stockQuantity = 0;
    }
    product.updatedAt = new Date();
    this.products.set(product.id, product);
    return product;
  }

  async generateImportTemplate(res: Response): Promise<void> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Danh mục sản phẩm');

    // Headers
    sheet.columns = [
      { header: 'Mã SKU (*)', key: 'sku', width: 20 },
      { header: 'Tên sản phẩm (*)', key: 'name', width: 30 },
      { header: 'Ngành hàng (*)', key: 'category', width: 20 },
      { header: 'Đơn vị tính (*)', key: 'baseUnit', width: 15 },
      { header: 'Giá bán (*)', key: 'price', width: 15 },
      { header: 'Giá vốn (*)', key: 'costPrice', width: 15 },
      { header: 'Tồn kho ban đầu', key: 'stockQuantity', width: 15 },
      { header: 'Mã vạch', key: 'barcode', width: 20 },
      { header: 'Mô tả', key: 'description', width: 30 },
    ];

    // Example row
    sheet.addRow({
      sku: 'SP-001',
      name: 'Sản phẩm mẫu',
      category: 'Hàng hóa',
      baseUnit: 'Cái',
      price: 100000,
      costPrice: 80000,
      stockQuantity: 10,
      barcode: '8931234567890',
      description: 'Đây là dòng dữ liệu mẫu, hãy xóa dòng này trước khi nhập',
    });

    // Style the header
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD3D3D3' } };

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename=Template_Nhap_SanPham.xlsx',
    );

    await workbook.xlsx.write(res);
    res.end();
  }

  async previewImport(file: Express.Multer.File): Promise<PreviewImportResult> {
    if (!file) {
      throw new BadRequestException('Vui lòng tải lên tệp Excel');
    }

    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(file.buffer);
    } catch (error) {
      throw new BadRequestException('Tệp không đúng định dạng Excel');
    }

    const sheet = workbook.worksheets[0];
    if (!sheet) {
      throw new BadRequestException('Tệp Excel không có dữ liệu');
    }

    const previewData: ImportProductItemDto[] = [];
    let validCount = 0;
    let invalidCount = 0;

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // Skip header

      const sku = row.getCell(1).text?.trim();
      const name = row.getCell(2).text?.trim();
      const category = row.getCell(3).text?.trim();
      const baseUnit = row.getCell(4).text?.trim();
      const price = Number(row.getCell(5).value) || 0;
      const costPrice = Number(row.getCell(6).value) || 0;
      const stockQuantity = Number(row.getCell(7).value) || 0;
      const barcode = row.getCell(8).text?.trim();
      const description = row.getCell(9).text?.trim();

      // Skip totally empty rows
      if (!sku && !name && !category && !baseUnit && price === 0 && costPrice === 0) return;

      const errors: string[] = [];
      
      if (!sku) errors.push('Mã SKU không được để trống');
      if (!name) errors.push('Tên sản phẩm không được để trống');
      if (!category) errors.push('Ngành hàng không được để trống');
      if (!baseUnit) errors.push('Đơn vị tính không được để trống');
      if (price <= 0) errors.push('Giá bán phải lớn hơn 0');
      if (costPrice <= 0) errors.push('Giá vốn phải lớn hơn 0');

      const existingProduct = Array.from(this.products.values()).find(
        (p) => p.sku.toLowerCase() === sku?.toLowerCase(),
      );

      const status = existingProduct ? 'UPDATE' : 'NEW';

      if (errors.length > 0) {
        invalidCount++;
      } else {
        validCount++;
      }

      previewData.push({
        row: rowNumber,
        sku: sku || '',
        name: name || '',
        category: category || '',
        baseUnit: baseUnit || '',
        price,
        costPrice,
        stockQuantity,
        barcode,
        description,
        status,
        errors,
        isValid: errors.length === 0,
      });
    });

    return {
      total: previewData.length,
      valid: validCount,
      invalid: invalidCount,
      data: previewData,
    };
  }

  async confirmImport(items: ImportProductItemDto[]): Promise<ConfirmImportResult> {
    let successCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    for (const item of items) {
      try {
        if (!item.isValid) {
          errorCount++;
          errors.push(`Dòng ${item.row}: Dữ liệu không hợp lệ`);
          continue;
        }

        if (item.status === 'UPDATE') {
          await this.update(item.sku, {
            name: item.name,
            category: item.category,
            baseUnit: item.baseUnit,
            price: item.price,
            costPrice: item.costPrice,
            barcode: item.barcode,
            description: item.description,
          });
        } else {
          await this.create({
            sku: item.sku,
            name: item.name,
            category: item.category,
            baseUnit: item.baseUnit,
            price: item.price,
            costPrice: item.costPrice,
            stockQuantity: item.stockQuantity,
            barcode: item.barcode,
            description: item.description,
          });
        }
        successCount++;
      } catch (err: any) {
        errorCount++;
        errors.push(`Dòng ${item.row}: ${err.message}`);
      }
    }

    return {
      success: successCount,
      error: errorCount,
      errorDetails: errors,
    };
  }
}
