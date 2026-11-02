// 发图前在手机上先压缩：最长边 1600 像素、JPEG，省流量也省模型费用
export async function compressImage(file, maxSide = 1600, quality = 0.85) {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件');
  if (file.size > 30 * 1024 * 1024) throw new Error('图片太大了');
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('这张图片打不开，换一张试试');
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return { dataUrl: canvas.toDataURL('image/jpeg', quality), width: w, height: h };
}

// 图标：从中间裁成正方形，缩到 size 像素（PNG，保留透明）
export async function squareIcon(file, size = 256) {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件');
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error('这张图片打不开，换一张试试'); }
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2; const sy = (bitmap.height - side) / 2;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  canvas.getContext('2d').drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);
  bitmap.close?.();
  return canvas.toDataURL('image/png');
}
