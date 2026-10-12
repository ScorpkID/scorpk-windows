import { useEffect, useState } from "react";

interface McpServerConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
}

export default function McpSettings({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"server" | "client">("server");
  const [copied, setCopied] = useState(false);
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [newName, setNewName] = useState("");
  const [newCommand, setNewCommand] = useState("");
  const [newArgs, setNewArgs] = useState("");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const exePath = "C:\\Users\\crist\\AppData\\Local\\Scorpk\\scorpk-windows.exe";

  const claudeConfig = JSON.stringify(
    {
      mcpServers: {
        scorpk: {
          command: exePath,
          args: ["--mcp-server"]
        }
      }
    },
    null,
    2
  );

  useEffect(() => {
    loadServers();
  }, []);

  async function loadServers() {
    try {
      if (!("__TAURI_INTERNALS__" in window)) return;
      const { invoke } = await import("@tauri-apps/api/core");
      const list = await invoke<McpServerConfig[]>("mcp_get_servers");
      setServers(list || []);
    } catch {
      // Ignorar si no está disponible en dev web
    }
  }

  async function saveServers(updated: McpServerConfig[]) {
    setServers(updated);
    try {
      if (!("__TAURI_INTERNALS__" in window)) return;
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("mcp_save_servers", { servers: updated });
    } catch (e) {
      setStatusMsg("Error guardando configuración.");
    }
  }

  function parseArgs(input: string): string[] {
    const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
    const matches: string[] = [];
    let match;
    while ((match = regex.exec(input)) !== null) {
      matches.push(match[1] || match[2] || match[0]);
    }
    return matches;
  }

  function addServer() {
    if (!newName.trim() || !newCommand.trim()) return;
    const argsArray = newArgs.trim() ? parseArgs(newArgs.trim()) : [];
    const server: McpServerConfig = {
      id: `mcp-${Date.now()}`,
      name: newName.trim(),
      command: newCommand.trim(),
      args: argsArray,
      env: {},
      enabled: true,
    };
    const updated = [...servers, server];
    saveServers(updated);
    setNewName("");
    setNewCommand("");
    setNewArgs("");
    setStatusMsg(`Servidor «${server.name}» añadido.`);
  }

  function removeServer(id: string) {
    const updated = servers.filter((s) => s.id !== id);
    saveServers(updated);
  }

  function copyConfig() {
    navigator.clipboard.writeText(claudeConfig);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <header className="mb-4 flex items-center justify-between border-b border-border pb-3">
          <div>
            <h2 className="text-lg font-semibold text-white">⚡ Model Context Protocol (MCP)</h2>
            <p className="text-xs text-muted">Ambas direcciones: Servidor (para Claude/Cursor) y Cliente (para conectar herramientas)</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-muted hover:bg-white/10 hover:text-white"
          >
            ✕
          </button>
        </header>

        {/* Pestañas de modo */}
        <div className="mb-4 flex gap-2 border-b border-border pb-2">
          <button
            onClick={() => setTab("server")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              tab === "server" ? "bg-white text-black" : "text-muted hover:text-white"
            }`}
          >
            1. Scorpk como Servidor MCP
          </button>
          <button
            onClick={() => setTab("client")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              tab === "client" ? "bg-white text-black" : "text-muted hover:text-white"
            }`}
          >
            2. Scorpk como Cliente MCP
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto pr-1 text-sm">
          {tab === "server" ? (
            <>
              <div className="rounded-xl border border-accent/30 bg-accent/10 p-3.5">
                <p className="font-medium text-white">🟢 Servidor MCP Integrado</p>
                <p className="mt-1 text-xs text-muted">
                  Otras IAs (Claude, Cursor, ChatGPT) pueden controlar Scorpk y usar sus herramientas de Windows, Celular Android (WhatsApp, Spotify, YouTube) y TV Samsung.
                </p>
              </div>

              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
                  Herramientas expuestas (Tools)
                </h3>
                <div className="space-y-2">
                  <div className="rounded-lg border border-border bg-black/40 p-2.5">
                    <span className="font-mono text-xs text-accent">scorpk_android_task</span>
                    <p className="text-xs text-muted">WhatsApp a contactos, música en Spotify y videos en YouTube vía ADB.</p>
                  </div>
                  <div className="rounded-lg border border-border bg-black/40 p-2.5">
                    <span className="font-mono text-xs text-accent">scorpk_tv_control</span>
                    <p className="text-xs text-muted">Encendido Wake-on-LAN, volumen, apps y teclas en televisores Samsung Tizen.</p>
                  </div>
                  <div className="rounded-lg border border-border bg-black/40 p-2.5">
                    <span className="font-mono text-xs text-accent">scorpk_open_app</span>
                    <p className="text-xs text-muted">Apertura segura de cualquier software instalado en Windows.</p>
                  </div>
                  <div className="rounded-lg border border-border bg-black/40 p-2.5">
                    <span className="font-mono text-xs text-accent">scorpk_volume_control & scorpk_media_control</span>
                    <p className="text-xs text-muted">Control de volumen del sistema y reproducción multimedia.</p>
                  </div>
                </div>
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                    1. Vía Local (Claude Desktop / Cursor)
                  </h3>
                  <button
                    onClick={copyConfig}
                    className="text-xs text-accent hover:underline"
                  >
                    {copied ? "✓ Copiado" : "Copiar JSON"}
                  </button>
                </div>
                <pre className="overflow-x-auto rounded-xl border border-border bg-black p-3 font-mono text-xs text-zinc-300">
                  {claudeConfig}
                </pre>
              </div>

              <div className="rounded-xl border border-border bg-black/40 p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                    2. Vía URL SSE / HTTPS (Gemini Spark / Web)
                  </h3>
                  <span className="rounded bg-accent/20 px-2 py-0.5 text-[10px] font-medium text-accent">
                    Puerto 3005 Activo
                  </span>
                </div>
                <p className="text-xs text-muted">
                  Scorpk incluye un servidor HTTP / SSE en el puerto <span className="font-mono text-white">3005</span>. Para servicios web en la nube como <strong>Gemini Spark</strong> (que requieren HTTPS obligatorio):
                </p>
                <div className="space-y-1.5 font-mono text-xs">
                  <div className="rounded-lg border border-border bg-black p-2 text-zinc-300">
                    <p className="text-[10px] text-muted">Paso 1: Abre PowerShell y crea un túnel HTTPS seguro:</p>
                    <p className="text-accent">ngrok http 3005</p>
                  </div>
                  <div className="rounded-lg border border-border bg-black p-2 text-zinc-300">
                    <p className="text-[10px] text-muted">Paso 2: Copia la URL HTTPS asignada y pega en Gemini Spark con /sse:</p>
                    <p className="text-white">https://tu-subdominio.ngrok-free.app/sse</p>
                  </div>
                </div>
                <p className="text-[11px] text-faint">
                  * También puedes usar <span className="font-mono text-zinc-300">http://localhost:3005/sse</span> para clientes MCP locales compatibles con HTTP/SSE.
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-xl border border-blue-400/30 bg-blue-400/10 p-3.5">
                <p className="font-medium text-white">🌐 Scorpk como Cliente MCP</p>
                <p className="mt-1 text-xs text-muted">
                  Conecta servidores MCP externos a Scorpk (ej. Filesystem, GitHub, PostgreSQL, SQLite) para que Scorpk gane habilidades adicionales automáticamente.
                </p>
              </div>

              {/* Lista de servidores conectados */}
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
                  Servidores MCP Conectados ({servers.length})
                </h3>
                {servers.length === 0 ? (
                  <p className="text-xs text-muted">No tienes servidores MCP externos configurados aún.</p>
                ) : (
                  <div className="space-y-2">
                    {servers.map((srv) => (
                      <div
                        key={srv.id}
                        className="flex items-center justify-between rounded-lg border border-border bg-black/40 p-2.5"
                      >
                        <div>
                          <p className="font-semibold text-white text-xs">{srv.name}</p>
                          <p className="font-mono text-[11px] text-muted">
                            {srv.command} {srv.args.join(" ")}
                          </p>
                        </div>
                        <button
                          onClick={() => removeServer(srv.id)}
                          className="rounded px-2 py-1 text-xs text-red-400 hover:bg-red-400/10"
                        >
                          Eliminar
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Formulario para añadir servidor */}
              <div className="rounded-xl border border-border bg-black/40 p-3.5">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
                  Añadir nuevo servidor MCP
                </h3>
                <div className="space-y-2">
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Nombre (ej. Filesystem, SQLite, GitHub)"
                    className="w-full rounded-lg border border-border bg-black px-3 py-1.5 text-xs text-white outline-none focus:border-accent"
                  />
                  <input
                    type="text"
                    value={newCommand}
                    onChange={(e) => setNewCommand(e.target.value)}
                    placeholder="Comando (ej. npx o python)"
                    className="w-full rounded-lg border border-border bg-black px-3 py-1.5 text-xs text-white outline-none focus:border-accent"
                  />
                  <input
                    type="text"
                    value={newArgs}
                    onChange={(e) => setNewArgs(e.target.value)}
                    placeholder="Argumentos (ej. -y @modelcontextprotocol/server-filesystem C:\\)"
                    className="w-full rounded-lg border border-border bg-black px-3 py-1.5 text-xs text-white outline-none focus:border-accent"
                  />
                  <button
                    onClick={addServer}
                    className="w-full rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-black hover:opacity-90"
                  >
                    + Conectar servidor MCP
                  </button>
                </div>
                {statusMsg && <p className="mt-2 text-xs text-accent">{statusMsg}</p>}
              </div>
            </>
          )}
        </div>

        <footer className="mt-5 flex justify-end border-t border-border pt-3">
          <button
            onClick={onClose}
            className="rounded-full bg-white px-5 py-2 text-xs font-semibold text-black hover:bg-zinc-200"
          >
            Cerrar
          </button>
        </footer>
      </div>
    </div>
  );
}
