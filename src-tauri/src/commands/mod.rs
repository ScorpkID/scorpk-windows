//! Comandos nativos que invoca el frontend (`invoke`). Cada módulo = una familia de acciones.
//! Regla de seguridad: ningún comando construye líneas de shell con texto del usuario o del modelo.

pub mod apps;
pub mod battery;
pub mod keys;
pub mod login;
