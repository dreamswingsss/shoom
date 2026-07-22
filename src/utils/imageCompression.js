import * as ImageManipulator from 'expo-image-manipulator';

// A modern phone camera photo is routinely 3000-4000px wide and several MB
// even at ImagePicker's own quality:0.8 JPEG setting (that setting only
// controls JPEG compression, not pixel dimensions) — that's what was
// actually causing "Network request timed out" on the Storage upload over a
// normal mobile connection, not a Supabase/RLS misconfiguration. Downscaling
// to a width no AI vision model or closet thumbnail needs more than, then
// re-compressing, keeps every scanned photo in the low-hundreds-of-KB range.
const MAX_WIDTH = 1600;
const JPEG_QUALITY = 0.7;

// `originalWidth` (from ImagePicker's own asset.width) decides whether a
// resize step is needed at all — skips upscaling a library image that's
// already smaller than MAX_WIDTH, while still always re-encoding it at
// JPEG_QUALITY for the compression benefit.
export async function compressImage(uri, originalWidth) {
  const actions = originalWidth && originalWidth > MAX_WIDTH ? [{ resize: { width: MAX_WIDTH } }] : [];

  const result = await ImageManipulator.manipulateAsync(uri, actions, {
    compress: JPEG_QUALITY,
    format: ImageManipulator.SaveFormat.JPEG,
  });

  return result.uri;
}
