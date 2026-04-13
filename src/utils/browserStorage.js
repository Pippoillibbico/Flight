function getLocalStorage() {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readLocalStorageItem(key) {
  const storage = getLocalStorage();
  if (!storage) return null;
  try {
    return storage.getItem(String(key || ''));
  } catch {
    return null;
  }
}

export function writeLocalStorageItem(key, value) {
  const storage = getLocalStorage();
  if (!storage) return false;
  try {
    storage.setItem(String(key || ''), String(value ?? ''));
    return true;
  } catch {
    return false;
  }
}

export function removeLocalStorageItem(key) {
  const storage = getLocalStorage();
  if (!storage) return false;
  try {
    storage.removeItem(String(key || ''));
    return true;
  } catch {
    return false;
  }
}
