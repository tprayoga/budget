/** Ukuran baru dengan sisi terpanjang maksimal `max` (tidak memperbesar). */
export function scaleToFit(width: number, height: number, max: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const k = max / longest;
  return { width: Math.round(width * k), height: Math.round(height * k) };
}

/**
 * Kompres foto nota di browser sebelum diunggah (sisi terpanjang ±1600 px, JPEG kualitas 0,7).
 * File non-gambar (mis. PDF) dikembalikan apa adanya.
 */
export async function compressImage(file: File, max = 1600, quality = 0.7): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const { width, height } = scaleToFit(bitmap.width, bitmap.height, max);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob || blob.size >= file.size) return file;
  return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
}
