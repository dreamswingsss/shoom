import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';

function stripBase64Prefix(base64) {
  return base64.replace(/^data:.*;base64,/, '');
}

async function readImageAsBase64Web(imageUri) {
  const blobResponse = await fetch(imageUri);
  const blob = await blobResponse.blob();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(stripBase64Prefix(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function readImageAsBase64Native(imageUri) {
  const base64 = await FileSystem.readAsStringAsync(imageUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return stripBase64Prefix(base64);
}

export async function readImageAsBase64(imageUri) {
  return Platform.OS === 'web'
    ? readImageAsBase64Web(imageUri)
    : readImageAsBase64Native(imageUri);
}
