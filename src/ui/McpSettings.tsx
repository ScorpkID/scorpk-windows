import { useState } from "react";

export default function McpSettings({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const claudeConfig = JSON.stringify(
    {
      mcpServers: {
        scorpk: {
          command: "C:\\Program Files\\Scorpk\\scorpk-windows.exe",
          args: ["--mcp-server"]
        }
      }
    },
    null,
    2
  );

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
            <h2 className="text-lg font-semibold text-white">⚡ Servidor MCP de Scorpk</h2>
            <p className="text-xs text-muted">Model Context Protocol para Claude, Cursor y ChatGPT</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-muted hover:bg-white/10 hover:text-white"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto pr-1 text-sm">
          <div className="rounded-xl border border-accent/30 bg-accent/10 p-3.5">
            <p className="font-medium text-white">🟢 Servidor MCP Integrado</p>
            <p className="mt-1 text-xs text-muted">
              Scorpk ahora puede ser controlado directamente por clientes de IA externos. Expone tus herramientas nativas de Windows, control de celular Android (WhatsApp, Spotify, YouTube) y TV Samsung.
            </p>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
              Herramientas expuestas (Tools)
            </h3>
            <div className="space-y-2">
              <div className="rounded-lg border border-border bg-black/40 p-2.5">
                <span className="font-mono text-xs text-accent">scorpk_android_task</span>
                <p className="text-xs text-muted">Control profundo de Android: enviar WhatsApps directos, música en Spotify y videos en YouTube.</p>
              </div>
              <div className="rounded-lg border border-border bg-black/40 p-2.5">
                <span className="font-mono text-xs text-accent">scorpk_tv_control</span>
                <p className="text-xs text-muted">Encendido Wake-on-LAN, volumen, apps y teclas en televisores Samsung Tizen.</p>
              </div>
              <div className="rounded-lg border border-border bg-black/40 p-2.5">
                <span className="font-mono text-xs text-accent">scorpk_open_app</span>
                <p className="text-xs text-muted">Apertura segura de cualquier software o app instalada en Windows.</p>
              </div>
              <div className="rounded-lg border border-border bg-black/40 p-2.5">
                <span className="font-mono text-xs text-accent">scorpk_volume_control & scorpk_media_control</span>
                <p className="text-xs text-muted">Control total de volumen de Windows y reproducción multimedia.</p>
              </div>
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                Configuración en Claude Desktop / Cursor
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
