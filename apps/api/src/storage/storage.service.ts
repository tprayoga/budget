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
/** Batas ukuran upload lampiran/foto nota (UPLOAD_MAX_MB, default 10 MB). */
export const MAX_UPLOAD_BYTES = Number(process.env.UPLOAD_MAX_MB ?? 10) * 1024 * 1024;

/**
 * Jenis file dari isi (magic bytes), bukan dari header Content-Type kiriman klien.
 * pdf | png | jpeg | webp | zip (xlsx/docx) | ole (xls/doc) | null.
 */
export function sniffFileType(buf: Buffer): 'pdf' | 'png' | 'jpeg' | 'webp' | 'zip' | 'ole' | null {
  const b = (i: number) => buf[i];
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf.length >= 8 && b(0) === 0x89 && buf.subarray(1, 4).toString('latin1') === 'PNG') return 'png';
  if (buf.length >= 3 && b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return 'jpeg';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (buf.length >= 4 && b(0) === 0x50 && b(1) === 0x4b && b(2) === 0x03 && b(3) === 0x04) return 'zip';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return 'ole';
  return null;
}

/** Content-Type yang diklaim harus sesuai isi file. */
export function mimeMatchesContent(mime: string, buf: Buffer): boolean {
  const t = sniffFileType(buf);
  if (mime === 'application/pdf') return t === 'pdf';
  if (mime === 'image/png') return t === 'png';
  if (mime === 'image/jpeg' || mime === 'image/jpg') return t === 'jpeg';
  if (mime === 'image/webp') return t === 'webp';
  if (mime.startsWith('application/vnd.openxmlformats-officedocument.')) return t === 'zip';
  if (mime === 'application/vnd.ms-excel' || mime === 'application/msword') return t === 'ole';
  return false;
}

/** Penyimpanan file lampiran di disk lokal (UPLOAD_DIR). fileUrl = path relatif terhadap UPLOAD_DIR. */
@Injectable()
export class StorageService {
  private readonly root = path.resolve(process.env.UPLOAD_DIR ?? './storage/uploads');

  absolute(fileUrl: string): string {
    const abs = path.resolve(this.root, fileUrl);
    if (!abs.startsWith(this.root + path.sep)) throw new BadRequestException('Path file tidak valid');
    return abs;
  }

  /** Simpan lampiran pengajuan dana. */
  async save(fundRequestId: string, file: UploadedFile) {
    return this.saveIn('fr', fundRequestId, file);
  }

  /** Simpan file di folder `{area}/{ownerId}/`. */
  async saveIn(area: 'fr' | 'expense', ownerId: string, file: UploadedFile) {
    if (!ALLOWED.test(file.mimetype)) {
      throw new BadRequestException('Tipe file tidak didukung (PDF, gambar, Excel, Word)');
    }
    if (file.size > MAX_UPLOAD_BYTES) throw new BadRequestException(`Ukuran file maksimal ${process.env.UPLOAD_MAX_MB ?? 10} MB`);
    if (!mimeMatchesContent(file.mimetype, file.buffer)) {
      throw new BadRequestException('Isi file tidak sesuai jenisnya (dicek dari isi file, bukan nama/ekstensi)');
    }
    const safe = file.originalname.replace(/[^\w.-]+/g, '_').slice(-80) || 'file';
    const rel = path.posix.join(area, ownerId.replace(/[^\w-]/g, ''), `${randomBytes(6).toString('hex')}-${safe}`);
    const abs = this.absolute(rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, file.buffer);
    return { fileUrl: rel, fileName: file.originalname, mimeType: file.mimetype, size: file.size };
  }

  async remove(fileUrl: string) {
    await rm(this.absolute(fileUrl), { force: true });
  }
}
