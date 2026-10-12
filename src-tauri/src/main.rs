// Evita la ventana de consola extra en Windows (release).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--mcp-server" || a == "mcp") {
        scorpk_windows_lib::mcp_server::run_stdio_server();
        return;
    }

    scorpk_windows_lib::run()
}
