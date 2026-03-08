import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Activity, AlertTriangle, CheckCircle2, Database, ShieldAlert, ShieldCheck, Zap } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type Node = { id: string; type: 'ecp' | 'broker'; status: 'UP' | 'DOWN'; name: string; certExpiry?: number; x: number; y: number };
type Link = { source: string; target: string };
type Message = { id: string; source: string; target: string; path: string[]; status: 'success' | 'failed'; startTime: number; duration: number; progress: number };

export default function App() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);

  useEffect(() => {
    const eventSource = new EventSource('/api/stream');
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setNodes(data.nodes);
      setLinks(data.links);
      setMessages(data.messages);
      
      if (selectedNode) {
        const updated = data.nodes.find((n: Node) => n.id === selectedNode.id);
        if (updated) setSelectedNode(updated);
      }
    };
    return () => eventSource.close();
  }, [selectedNode]);

  const toggleNodeStatus = async (id: string) => {
    await fetch(`/api/nodes/${id}/toggle`, { method: 'POST' });
  };

  const updateCertExpiry = async (id: string, days: number) => {
    await fetch(`/api/nodes/${id}/cert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days })
    });
  };

  const totalMessages = messages.length;
  const failedMessages = messages.filter(m => m.status === 'failed').length;
  const nodesDown = nodes.filter(n => n.status === 'DOWN').length;
  const expiringCerts = nodes.filter(n => n.type === 'ecp' && n.certExpiry !== undefined && n.certExpiry <= 15).length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-indigo-500/30">
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center border border-indigo-500/30">
              <Activity className="w-5 h-5 text-indigo-400" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-100">ECP Simulator Endpoint</h1>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <a href="/metrics" target="_blank" className="text-slate-400 hover:text-slate-200 transition-colors flex items-center gap-2 bg-slate-800/50 px-3 py-1.5 rounded-lg border border-slate-700/50">
              <Activity className="w-4 h-4" />
              Prometheus Metrics
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-4 gap-8">
        
        {/* Left Sidebar - Stats */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
            <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-4">Network Health</h2>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={cn("p-2 rounded-lg", nodesDown > 0 ? "bg-red-500/10 text-red-400" : "bg-emerald-500/10 text-emerald-400")}>
                    <Activity className="w-5 h-5" />
                  </div>
                  <span className="text-slate-300">Nodes Down</span>
                </div>
                <span className={cn("font-mono text-lg", nodesDown > 0 ? "text-red-400" : "text-emerald-400")}>{nodesDown}</span>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={cn("p-2 rounded-lg", failedMessages > 0 ? "bg-amber-500/10 text-amber-400" : "bg-blue-500/10 text-blue-400")}>
                    <Zap className="w-5 h-5" />
                  </div>
                  <span className="text-slate-300">Active Messages</span>
                </div>
                <span className="font-mono text-lg text-slate-200">{totalMessages}</span>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={cn("p-2 rounded-lg", expiringCerts > 0 ? "bg-orange-500/10 text-orange-400" : "bg-emerald-500/10 text-emerald-400")}>
                    <ShieldAlert className="w-5 h-5" />
                  </div>
                  <span className="text-slate-300">Expiring Certs</span>
                </div>
                <span className={cn("font-mono text-lg", expiringCerts > 0 ? "text-orange-400" : "text-emerald-400")}>{expiringCerts}</span>
              </div>
            </div>
          </div>

          <AnimatePresence>
            {selectedNode && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="bg-slate-900 border border-slate-800 rounded-2xl p-5"
              >
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-medium text-slate-100">{selectedNode.name}</h2>
                  <span className="text-xs font-mono text-slate-500 bg-slate-800 px-2 py-1 rounded">{selectedNode.type.toUpperCase()}</span>
                </div>

                <div className="space-y-6">
                  <div>
                    <label className="text-sm text-slate-400 block mb-2">Status</label>
                    <button
                      onClick={() => toggleNodeStatus(selectedNode.id)}
                      className={cn(
                        "w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium transition-all",
                        selectedNode.status === 'UP' 
                          ? "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20" 
                          : "bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20"
                      )}
                    >
                      {selectedNode.status === 'UP' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                      {selectedNode.status === 'UP' ? 'Node is UP (Click to Fail)' : 'Node is DOWN (Click to Recover)'}
                    </button>
                  </div>

                  {selectedNode.type === 'ecp' && (
                    <div>
                      <label className="text-sm text-slate-400 block mb-2">Certificate Expiry (Days)</label>
                      <div className="flex gap-2">
                        <input 
                          type="number" 
                          value={selectedNode.certExpiry || 0}
                          onChange={(e) => updateCertExpiry(selectedNode.id, parseInt(e.target.value) || 0)}
                          className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 w-full text-slate-200 font-mono focus:outline-none focus:border-indigo-500/50"
                        />
                        <button 
                          onClick={() => updateCertExpiry(selectedNode.id, 3)}
                          className="px-3 py-2 bg-orange-500/10 text-orange-400 rounded-xl border border-orange-500/20 hover:bg-orange-500/20 whitespace-nowrap text-sm"
                        >
                          Simulate Expiring
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right Area - Map */}
        <div className="lg:col-span-3 bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden relative min-h-[600px]">
          <NetworkMap
            nodes={nodes}
            links={links}
            selectedNode={selectedNode}
            onSelectNode={setSelectedNode}
          />
        </div>

      </main>
    </div>
  );
}

function NetworkMap({ nodes, links, selectedNode, onSelectNode }: { nodes: Node[], links: Link[], selectedNode: Node | null, onSelectNode: (n: Node) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setTransform(t => ({
      ...t,
      x: dragStart.current.tx + (e.clientX - dragStart.current.x),
      y: dragStart.current.ty + (e.clientY - dragStart.current.y),
    }));
  };

  const handleMouseUp = () => setIsDragging(false);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = containerRef.current!.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setTransform(t => {
      const newScale = Math.max(0.3, Math.min(3, t.scale * delta));
      return {
        x: mouseX - (mouseX - t.x) * (newScale / t.scale),
        y: mouseY - (mouseY - t.y) * (newScale / t.scale),
        scale: newScale,
      };
    });
  };

  const getNodeCoords = (id: string) => {
    const n = nodes.find(n => n.id === id);
    return n ? { x: n.x, y: n.y } : { x: 0, y: 0 };
  };

  return (
    <div
      ref={containerRef}
      className={cn("absolute inset-0 w-full h-full select-none", isDragging ? "cursor-grabbing" : "cursor-grab")}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
    >
      {/* Contenu transformé : SVG + nœuds */}
      <div style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`, transformOrigin: '0 0', position: 'absolute', inset: 0 }}>
        {/* SVG Layer for Links and Messages */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          <defs>
            <linearGradient id="link-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#334155" />
              <stop offset="100%" stopColor="#475569" />
            </linearGradient>
          </defs>

          {/* Links */}
          {links.map((link, i) => {
            const source = getNodeCoords(link.source);
            const target = getNodeCoords(link.target);
            return (
              <line
                key={i}
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                stroke="url(#link-gradient)"
                strokeWidth="2"
                strokeDasharray="4 4"
                className="opacity-40"
              />
            );
          })}

        </svg>

        {/* HTML Layer for Nodes */}
        {nodes.map(node => (
          <button
            key={node.id}
            onClick={() => onSelectNode(node)}
            onMouseDown={(e) => e.stopPropagation()}
            className={cn(
              "absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-2 transition-transform hover:scale-110",
              selectedNode?.id === node.id ? "z-20" : "z-10"
            )}
            style={{ left: node.x, top: node.y }}
          >
            <div className={cn(
              "w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg border-2 transition-colors relative",
              node.status === 'UP'
                ? "bg-slate-800 border-slate-700 text-slate-300"
                : "bg-red-950/80 border-red-500/50 text-red-400",
              selectedNode?.id === node.id && (node.status === 'UP' ? "border-indigo-500 shadow-indigo-500/20" : "border-red-500 shadow-red-500/20")
            )}>
              {node.type === 'broker'
                ? <Database className="w-6 h-6" />
                : <ShieldCheck className="w-6 h-6" />
              }
              <div className={cn(
                "absolute -top-1 -right-1 w-4 h-4 rounded-full border-2 border-slate-900",
                node.status === 'UP' ? "bg-emerald-500" : "bg-red-500"
              )} />
            </div>
            <div className="bg-slate-950/80 backdrop-blur px-3 py-1.5 rounded-lg border border-slate-800 shadow-xl flex flex-col items-center">
              <span className="text-xs font-semibold whitespace-nowrap text-slate-200">{node.name}</span>
              {node.type === 'ecp' && node.certExpiry !== undefined && (
                <span className={cn(
                  "text-[10px] font-mono mt-0.5",
                  node.certExpiry <= 15 ? "text-orange-400" : "text-slate-400"
                )}>
                  Cert: {node.certExpiry}d
                </span>
              )}
            </div>
          </button>
        ))}
      </div>

      {/* Bouton reset — hors du div transformé */}
      <button
        onClick={() => setTransform({ x: 0, y: 0, scale: 1 })}
        className="absolute bottom-3 right-3 z-30 text-xs px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition-colors"
      >
        Reset vue
      </button>

      {/* Indicateur de zoom */}
      <div className="absolute bottom-3 left-3 z-30 text-xs text-slate-500 bg-slate-800/70 px-2 py-1 rounded-lg border border-slate-700/50">
        {Math.round(transform.scale * 100)}%
      </div>
    </div>
  );
}

