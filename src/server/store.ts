import { STORE_PATH } from "./config";

let storeCache: Record<string, any> | null = null;

export async function readStore(): Promise<Record<string, any>> {
  if (storeCache) return storeCache;
  try {
    const file = Bun.file(STORE_PATH);
    if (!(await file.exists())) { storeCache = {}; return storeCache; }
    storeCache = await file.json();
    return storeCache!;
  } catch {
    storeCache = {};
    return storeCache;
  }
}

export async function writeStore(data: Record<string, any>): Promise<void> {
  storeCache = data;
  try {
    await Bun.write(STORE_PATH, JSON.stringify(data, null, 2));
  } catch (e: any) {
    console.error(`[store] Write failed (${e.code || e.message}). Data kept in memory only.`);
  }
}
