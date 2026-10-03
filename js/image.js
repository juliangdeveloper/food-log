export function readOriginalImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error("not_image"));
      return;
    }
    if (file.type && !file.type.startsWith("image/")) {
      reject(new Error("not_image"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("read"));
    reader.readAsDataURL(file);
  });
}
