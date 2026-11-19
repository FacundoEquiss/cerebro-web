"use client";
// Photos are shrunk IN THE BROWSER before they travel: 1600 px on the longest side at most,
// encoded as WebP. A 6 MB phone photo becomes ~200 KB, the upload is fast on mobile data and the
// server never has to process an image.

export const MAX_SIDE = 1600;

export interface ShrunkImage {
  blob: Blob;
  width: number;
  height: number;
}

export async function shrinkImage(file: File, maxSide = MAX_SIDE): Promise<ShrunkImage> {
  // Decoded through an <img>: it reads every format the browser can show.
  const url = URL.createObjectURL(file);
  try {
    const source = new Image();
    source.decoding = "async";
    source.src = url;
    await source.decode();
    const scale = Math.min(1, maxSide / Math.max(source.naturalWidth, source.naturalHeight));
    var width = Math.max(1, Math.round(source.naturalWidth * scale));
    var height = Math.max(1, Math.round(source.naturalHeight * scale));
    var canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.drawImage(source, 0, 0, width, height);
  } finally {
    URL.revokeObjectURL(url);
  }
  const encode = (type: string, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  // A browser that cannot write WebP answers with PNG: fall back to JPEG instead.
  let blob = await encode("image/webp", 0.82);
  if (!blob || blob.type !== "image/webp") blob = await encode("image/jpeg", 0.85);
  if (!blob) throw new Error("encode");
  return { blob, width, height };
}
