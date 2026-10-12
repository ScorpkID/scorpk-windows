// Evita la ventana de consola extra en Windows (release).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--mcp-http") {
        let port: u16 = args.iter().position(|a| a == "--mcp-http")
            .and_then(|i| args.get(i + 1))
            .and_then(|p| p.parse().ok())
            .unwrap_or(3005);
        scorpk_windows_lib::mcp_server::start_http_server(port);
        // Mantener el hilo principal vivo en modo servidor HTTP CLI
        loop {
            std::thread::sleep(std::time::Duration::from_secs(3600));
        }
    }
    if args.iter().any(|a| a == "--mcp-server" || a == "mcp") {
        scorpk_windows_lib::mcp_server::run_stdio_server();
        return;
    }

    scorpk_windows_lib::run()
}
