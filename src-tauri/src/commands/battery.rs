//! `battery_status`: nivel y estado de carga con GetSystemPowerStatus.

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatteryInfo {
    /// 0-100, o None si no se conoce / no hay batería.
    pub percent: Option<u8>,
    pub charging: bool,
    pub has_battery: bool,
}

#[cfg(windows)]
#[tauri::command]
pub fn battery_status() -> Result<BatteryInfo, String> {
    use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};

    let mut status = SYSTEM_POWER_STATUS::default();
    // SAFETY: se pasa un puntero válido a una estructura propia e inicializada.
    unsafe { GetSystemPowerStatus(&mut status) }.map_err(|_| "No pude leer la batería.".to_string())?;

    // BatteryFlag: 128 = sin batería, 255 = desconocido. BatteryLifePercent: 255 = desconocido.
    let has_battery = status.BatteryFlag != 128 && status.BatteryFlag != 255;
    let percent = if has_battery && status.BatteryLifePercent <= 100 { Some(status.BatteryLifePercent) } else { None };
    Ok(BatteryInfo { percent, charging: status.ACLineStatus == 1, has_battery })
}

#[cfg(not(windows))]
#[tauri::command]
pub fn battery_status() -> Result<BatteryInfo, String> {
    Ok(BatteryInfo { percent: None, charging: false, has_battery: false })
}
