import { BadRequestException, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const ALLOWED = /^(application\/pdf|image\/(png|jpe?g|webp)|application\/vnd\.openxmlformats-officedocument\.(spreadsheetml\.sheet|wordprocessingml\.document)|application\/vnd\.ms-excel|application\/msword)$/;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Penyimpanan file lampiran di disk lokal (UPLOAD_DIR). fileUrl = path relatif terhadap UPLOAD_DIR. */
@Injectable()
export class StorageService {
  private readonly root = path.resolve(process.env.UPLOAD_DIR ?? './storage/uploads');

  absolute(fileUrl: string): string {
    const abs = path.resolve(this.root, fileUrl);
    if (!abs.startsWith(this.root + path.sep)) throw new BadRequestException('Path file tidak valid');
    return abs;
  }

  async save(fundRequestId: string, file: UploadedFile) {
    if (!ALLOWED.test(file.mimetype)) {
      throw new BadRequestException('Tipe file tidak didukung (PDF, gambar, Excel, Word)');
    }
    if (file.size > MAX_UPLOAD_BYTES) throw new BadRequestException('Ukuran file maksimal 10 MB');
    const safe = file.originalname.replace(/[^\w.-]+/g, '_').slice(-80) || 'file';
    const rel = path.posix.join('fr', fundRequestId.replace(/[^\w-]/g, ''), `${randomBytes(6).toString('hex')}-${safe}`);
    const abs = this.absolute(rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, file.buffer);
    return { fileUrl: rel, fileName: file.originalname, mimeType: file.mimetype, size: file.size };
  }

  async remove(fileUrl: string) {
    await rm(this.absolute(fileUrl), { force: true });
  }
}
