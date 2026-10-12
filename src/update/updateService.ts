export interface WindowsReleaseInfo {
  version: string;
  versionCode: number;
  minSupportedVersion: string;
  downloadUrl: string;
  sha256: string;
  sizeBytes: number;
  releasedAt: string;
  notes: string[];
}

export const CURRENT_WINDOWS_VERSION = "0.1.8";
export const WINDOWS_LATEST_URL = "https://scorpk.tech/windows/latest.json";

/** Compara dos versiones semánticas (ej. "0.1.0" vs "0.1.1"). Devuelve >0 si v1 > v2. */
export function compareSemver(v1: string, v2: string): number {
  const p1 = v1.split(".").map((n) => parseInt(n, 10) || 0);
  const p2 = v2.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const n1 = p1[i] ?? 0;
    const n2 = p2[i] ?? 0;
    if (n1 > n2) return 1;
    if (n1 < n2) return -1;
  }
  return 0;
}

/** Consulta el anuncio oficial en scorpk.tech/windows/latest.json. */
export async function checkForWindowsUpdate(): Promise<WindowsReleaseInfo | null> {
  try {
    const res = await fetch(WINDOWS_LATEST_URL, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as WindowsReleaseInfo;
    if (!data.version || !data.downloadUrl) return null;
    if (compareSemver(data.version, CURRENT_WINDOWS_VERSION) > 0) {
      return data;
    }
    return null;
  } catch {
    return null;
  }
}
