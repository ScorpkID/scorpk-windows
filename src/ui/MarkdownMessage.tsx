import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownMessageProps {
  content: string;
  isUser: boolean;
}

export function MarkdownMessage({ content, isUser }: MarkdownMessageProps) {
  if (isUser) {
    return <span className="whitespace-pre-wrap">{content}</span>;
  }

  return (
    <div className="prose prose-invert max-w-none text-sm leading-relaxed space-y-2">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || "");
            const codeString = String(children).replace(/\n$/, "");
            const isInline = !match && !codeString.includes("\n");

            if (isInline) {
              return (
                <code className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-xs text-emerald-400" {...props}>
                  {children}
                </code>
              );
            }

            return <CodeBlock language={match ? match[1] : "text"} code={codeString} />;
          },
          table({ children }) {
            return (
              <div className="my-3 overflow-x-auto rounded-lg border border-border">
                <table className="min-w-full divide-y divide-border text-left text-xs">{children}</table>
              </div>
            );
          },
          th({ children }) {
            return <th className="bg-white/5 px-3 py-2 font-semibold text-white">{children}</th>;
          },
          td({ children }) {
            return <td className="border-t border-border px-3 py-2 text-muted">{children}</td>;
          },
          ul({ children }) {
            return <ul className="my-2 list-disc pl-5 space-y-1 text-muted">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="my-2 list-decimal pl-5 space-y-1 text-muted">{children}</ol>;
          },
          p({ children }) {
            return <p className="mb-2 last:mb-0">{children}</p>;
          },
          strong({ children }) {
            return <strong className="font-semibold text-white">{children}</strong>;
          },
          a({ href, children }) {
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline hover:text-white">
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);

  function copyToClipboard() {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-border bg-[#111217]">
      <div className="flex items-center justify-between border-b border-border/60 bg-black/40 px-3 py-1.5 text-xs text-muted">
        <span className="font-mono text-[11px] font-medium uppercase tracking-wider text-muted">{language}</span>
        <button
          onClick={copyToClipboard}
          className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-muted hover:bg-white/10 hover:text-white transition"
          type="button"
        >
          {copied ? "✓ Copiado" : "Copiar"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed text-zinc-200">
        <code>{code}</code>
      </pre>
    </div>
  );
}
