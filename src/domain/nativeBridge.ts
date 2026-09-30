/** Puente hacia los comandos nativos de Rust (src-tauri/src/commands). Se inyecta para poder probar sin Tauri. */
export interface NativeBridge {
  invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T>;
}

export class NativeUnavailableError extends Error {
  constructor() {
    super("Esta acción solo funciona en la app de escritorio.");
  }
}

/** Implementación real: usa @tauri-apps/api; fuera de Tauri (navegador) lanza NativeUnavailableError. */
export const tauriBridge: NativeBridge = {
  async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    if (!("__TAURI_INTERNALS__" in window)) throw new NativeUnavailableError();
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(command, args);
  },
};

export interface BatteryInfo {
  /** 0-100, o null si el equipo no tiene batería / no se conoce. */
  percent: number | null;
  charging: boolean;
  hasBattery: boolean;
}
