import express from 'express';
import { createServer as createViteServer } from 'vite';
import promClient from 'prom-client';
import { Client as ESClient } from '@elastic/elasticsearch';

async function startServer() {
  const app = express();
  const PORT = 4000;

  app.use(express.json());

  const register = new promClient.Registry();
  promClient.collectDefaultMetrics({ register });

  const ecpLabels = ['ecp_name', 'location', 'instance'] as const;

  // ECP Endpoint Gauges
  const certStatus = new promClient.Gauge({ name: 'ecp_endpoint_certificates_status', help: 'Validite des certificats TLS', labelNames: ecpLabels, registers: [register] });
  const syncStatus = new promClient.Gauge({ name: 'ecp_endpoint_synchronization_status', help: 'Sync avec Component Directory', labelNames: ecpLabels, registers: [register] });
  const connectedBrokers = new promClient.Gauge({ name: 'ecp_endpoint_connected_brokers', help: 'Nombre de brokers connectes', labelNames: ecpLabels, registers: [register] });
  const brokenBrokers = new promClient.Gauge({ name: 'ecp_endpoint_connected_broken_brokers', help: 'Brokers en erreur', labelNames: ecpLabels, registers: [register] });
  const waitingDeliver = new promClient.Gauge({ name: 'ecp_endpoint_waiting_to_deliver_messages', help: 'Messages en attente livraison', labelNames: ecpLabels, registers: [register] });
  const waitingReceive = new promClient.Gauge({ name: 'ecp_endpoint_waiting_to_receive_messages', help: 'Messages en attente reception', labelNames: ecpLabels, registers: [register] });
  const messagesStore = new promClient.Gauge({ name: 'ecp_endpoint_messages_in_store', help: 'Messages dans le store', labelNames: ecpLabels, registers: [register] });
  const liveMessagesGauge = new promClient.Gauge({ name: 'ecp_endpoint_live_messages_in_store', help: 'Messages non finalises', labelNames: ecpLabels, registers: [register] });
  const reloadingGauge = new promClient.Gauge({ name: 'ecp_endpoint_reloading', help: 'Rechargement en cours', labelNames: ecpLabels, registers: [register] });
  const certExpiration = new promClient.Gauge({ name: 'ecp_endpoint_certificate_closest_expiration', help: 'Jours avant expiration certificat', labelNames: ecpLabels, registers: [register] });
  const noValidPath = new promClient.Gauge({ name: 'ecp_endpoint_is_without_valid_path', help: 'Absence de message path valide', labelNames: ecpLabels, registers: [register] });

  // Counters
  const sentMessages = new promClient.Counter({ name: 'ecp_endpoint_sent_messages_total', help: 'Messages envoyes (cumule)', labelNames: ecpLabels, registers: [register] });
  const receivedMessages = new promClient.Counter({ name: 'ecp_endpoint_received_messages_total', help: 'Messages recus (cumule)', labelNames: ecpLabels, registers: [register] });

  // Job success
  const jobSuccess = new promClient.Gauge({ name: 'ecp_endpoint_job_success', help: 'Succes du dernier job planifie', labelNames: [...ecpLabels, 'job'], registers: [register] });

  // JVM Metrics
  const jvmHeapUsed = new promClient.Gauge({ name: 'jvm_memory_used_bytes', help: 'Heap JVM utilisee', labelNames: [...ecpLabels, 'area'], registers: [register] });
  const jvmHeapMax = new promClient.Gauge({ name: 'jvm_memory_max_bytes', help: 'Heap JVM max', labelNames: [...ecpLabels, 'area'], registers: [register] });
  const processCpu = new promClient.Gauge({ name: 'process_cpu_usage', help: 'CPU du process Java', labelNames: ecpLabels, registers: [register] });
  const jvmThreads = new promClient.Gauge({ name: 'jvm_threads_live_threads', help: 'Threads actifs', labelNames: ecpLabels, registers: [register] });

  // Broker-level status (infrastructure partagée, indépendante des ECPs)
  const brokerStatus = new promClient.Gauge({
    name: 'ecp_broker_status',
    help: 'Statut du broker (1=OK, 0=EN ERREUR)',
    labelNames: ['broker_name', 'broker_instance'],
    registers: [register],
  });

  // ── State ──
  type Node = {
    id: string;
    type: 'ecp' | 'broker';
    status: 'UP' | 'DOWN';
    name: string;
    location?: string;
    instance?: string;
    certExpiry?: number;
    x: number;
    y: number;
  };
  type Link = { source: string; target: string };
  type Message = { id: string; source: string; target: string; path: string[]; status: 'success' | 'failed'; startTime: number; duration: number; progress: number };

  const nodes: Node[] = [
    { id: 'ecp-fr',   type: 'ecp',    status: 'UP', name: 'ECP-GRT-FR',    location: 'Paris',    instance: 'localhost:8000', certExpiry: 45, x: 100, y: 150 },
    { id: 'ecp-de',   type: 'ecp',    status: 'UP', name: 'ECP-GRT-DE',    location: 'Berlin',   instance: 'localhost:8001', certExpiry: 45, x: 100, y: 450 },
    { id: 'ecp-es',   type: 'ecp',    status: 'UP', name: 'ECP-GRT-ES',    location: 'Madrid',   instance: 'localhost:8002', certExpiry: 45, x: 900, y: 100 },
    { id: 'ecp-it',   type: 'ecp',    status: 'UP', name: 'ECP-GRT-IT',    location: 'Rome',     instance: 'localhost:8003', certExpiry: 45, x: 900, y: 300 },
    { id: 'ecp-be',   type: 'ecp',    status: 'UP', name: 'ECP-GRT-BE',    location: 'Brussels', instance: 'localhost:8004', certExpiry: 45, x: 900, y: 500 },
    { id: 'broker-a', type: 'broker', status: 'UP', name: 'BROKER-CORE-A', instance: 'broker-core-a:9092', x: 500, y: 150 },
    { id: 'broker-b', type: 'broker', status: 'UP', name: 'BROKER-CORE-B', instance: 'broker-core-b:9092', x: 500, y: 330 },
    { id: 'broker-c', type: 'broker', status: 'UP', name: 'BROKER-CORE-C', instance: 'broker-core-c:9092', x: 500, y: 510 },
  ];

  const links: Link[] = [
    // ECPs gauche → broker-a (primaire) + broker-b (central)
    { source: 'ecp-fr', target: 'broker-a' },
    { source: 'ecp-fr', target: 'broker-b' },
    { source: 'ecp-de', target: 'broker-a' },
    { source: 'ecp-de', target: 'broker-b' },
    // ECPs droite → broker-b (central) + broker-c (primaire)
    { source: 'ecp-es', target: 'broker-b' },
    { source: 'ecp-es', target: 'broker-c' },
    { source: 'ecp-it', target: 'broker-b' },
    { source: 'ecp-it', target: 'broker-c' },
    { source: 'ecp-be', target: 'broker-b' },
    { source: 'ecp-be', target: 'broker-c' },
  ];

  let messages: Message[] = [];
  let clients: express.Response[] = [];

  function ecpLabelsOf(node: Node) {
    return { ecp_name: node.name, location: node.location!, instance: node.instance! };
  }

  // ── Simulated metrics (mirrors ecp_simulator.py logic) ──
  function updateSimulatedMetrics() {
    const t = Date.now() / 1000;

    // ── États des brokers dérivés depuis les noeuds (piloté par l'utilisateur) ──
    let brokenBrokerCount = 0;
    const brokerNodes = nodes.filter(n => n.type === 'broker');
    for (const broker of brokerNodes) {
      const status = broker.status === 'UP' ? 1 : 0;
      brokerStatus.set({ broker_name: broker.name, broker_instance: broker.instance! }, status);
      if (status === 0) brokenBrokerCount++;
    }
    const currentUpBrokerCount = brokerNodes.length - brokenBrokerCount;

    for (const node of nodes) {
      if (node.type !== 'ecp') continue;
      const l = ecpLabelsOf(node);
      const noise = Math.random() * 0.1 - 0.05;

      const heapMaxBytes = 512 * 1024 * 1024;
      const heapRatio = Math.max(0.3, Math.min(0.98, 0.72 + 0.15 * Math.sin(t / 60) + noise));
      jvmHeapUsed.set({ ...l, area: 'heap' }, heapMaxBytes * heapRatio);
      jvmHeapMax.set({ ...l, area: 'heap' }, heapMaxBytes);

      processCpu.set(l, Math.max(0.01, Math.min(0.99, 0.15 + 0.12 * Math.sin(t / 45) + noise)));
      jvmThreads.set(l, Math.floor(55 + 15 * Math.sin(t / 90)));

      if (node.status === 'UP') {
        certStatus.set(l, 1);
        syncStatus.set(l, 1);
        connectedBrokers.set(l, currentUpBrokerCount);
        brokenBrokers.set(l, brokenBrokerCount);
      } else {
        certStatus.set(l, 0);
        syncStatus.set(l, 0);
        connectedBrokers.set(l, 0);
        brokenBrokers.set(l, 0);
      }

      const congestion = Math.abs(40 * Math.sin(t / 120));
      waitingDeliver.set(l, Math.floor(congestion + Math.random() * 10));
      waitingReceive.set(l, Math.floor(Math.random() * 20));

      messagesStore.set(l, Math.floor(5 + Math.random() * 45));
      liveMessagesGauge.set(l, Math.floor(Math.random() * 10));

      reloadingGauge.set(l, Math.random() < 0.02 ? 1 : 0);
      certExpiration.set(l, node.certExpiry! + (Math.random() * 10 - 5));
      noValidPath.set(l, 0);

      sentMessages.labels(l).inc(Math.floor(Math.random() * 6));
      receivedMessages.labels(l).inc(Math.floor(Math.random() * 5));

      for (const job of ['certRenewal', 'syncCD', 'cleanStore']) {
        jobSuccess.set({ ...l, job }, Math.random() > 0.02 ? 1 : 0);
      }
    }
  }

  updateSimulatedMetrics();
  setInterval(updateSimulatedMetrics, 5000);

  // ── Elasticsearch pusher ──
  const ES_URL = process.env.ELASTICSEARCH_URL || 'http://elasticsearch:9200';
  const esClient = new ESClient({ node: ES_URL });
  const ES_INDEX = 'ecp-metrics';

  // Track sent_messages_total and received_messages_total per ECP for ES documents
  const esSentTotal: Record<string, number> = {};
  const esReceivedTotal: Record<string, number> = {};
  for (const node of nodes) {
    if (node.type === 'ecp') {
      esSentTotal[node.id] = 0;
      esReceivedTotal[node.id] = 0;
    }
  }

  async function ensureESIndex() {
    try {
      const exists = await esClient.indices.exists({ index: ES_INDEX });
      if (!exists) {
        await esClient.indices.create({
          index: ES_INDEX,
          mappings: {
            properties: {
              '@timestamp': { type: 'date' },
              doc_type: { type: 'keyword' },
              ecp_name: { type: 'keyword' },
              location: { type: 'keyword' },
              instance: { type: 'keyword' },
              broker_name: { type: 'keyword' },
              broker_instance: { type: 'keyword' },
              heap_used_bytes: { type: 'long' },
              heap_max_bytes: { type: 'long' },
              heap_used_pct: { type: 'float' },
              cpu_usage: { type: 'float' },
              threads: { type: 'integer' },
              connected_brokers: { type: 'integer' },
              broken_brokers: { type: 'integer' },
              waiting_deliver: { type: 'integer' },
              waiting_receive: { type: 'integer' },
              messages_in_store: { type: 'integer' },
              live_messages_in_store: { type: 'integer' },
              cert_expiry_days: { type: 'float' },
              cert_status: { type: 'integer' },
              sync_status: { type: 'integer' },
              sent_messages_total: { type: 'long' },
              received_messages_total: { type: 'long' },
              is_down: { type: 'boolean' },
              broker_status: { type: 'integer' },
            },
          },
        });
        console.log(`[ES] Index "${ES_INDEX}" created.`);
      }
    } catch (err) {
      console.error('[ES] Index setup error:', err);
    }
  }

  async function pushMetricsToES() {
    const timestamp = new Date().toISOString();
    const t = Date.now() / 1000;
    const noise = () => Math.random() * 0.1 - 0.05;
    const heapMaxBytes = 512 * 1024 * 1024;
    const brokerNodes = nodes.filter(n => n.type === 'broker');
    const upBrokers = brokerNodes.filter(b => b.status === 'UP').length;
    const brokenBrokerCount = brokerNodes.length - upBrokers;
    const operations: object[] = [];

    for (const node of nodes) {
      if (node.type === 'ecp') {
        const heapRatio = Math.max(0.3, Math.min(0.98, 0.72 + 0.15 * Math.sin(t / 60) + noise()));
        const heapUsed = Math.floor(heapMaxBytes * heapRatio);
        const cpuUsage = Math.max(0.01, Math.min(0.99, 0.15 + 0.12 * Math.sin(t / 45) + noise()));
        const threads = Math.floor(55 + 15 * Math.sin(t / 90));
        const congestion = Math.abs(40 * Math.sin(t / 120));
        const waitingDeliver = Math.floor(congestion + Math.random() * 10);
        const waitingReceive = Math.floor(Math.random() * 20);
        const certExpiry = (node.certExpiry ?? 45) + (Math.random() * 10 - 5);
        const sentInc = Math.floor(Math.random() * 6);
        const receivedInc = Math.floor(Math.random() * 5);
        esSentTotal[node.id] = (esSentTotal[node.id] || 0) + sentInc;
        esReceivedTotal[node.id] = (esReceivedTotal[node.id] || 0) + receivedInc;

        const doc = {
          '@timestamp': timestamp,
          doc_type: 'ecp',
          ecp_name: node.name,
          location: node.location,
          instance: node.instance,
          heap_used_bytes: heapUsed,
          heap_max_bytes: heapMaxBytes,
          heap_used_pct: parseFloat((heapRatio * 100).toFixed(2)),
          cpu_usage: parseFloat((cpuUsage * 100).toFixed(2)),
          threads,
          connected_brokers: node.status === 'UP' ? upBrokers : 0,
          broken_brokers: node.status === 'UP' ? brokenBrokerCount : 0,
          waiting_deliver: waitingDeliver,
          waiting_receive: waitingReceive,
          messages_in_store: Math.floor(5 + Math.random() * 45),
          live_messages_in_store: Math.floor(Math.random() * 10),
          cert_expiry_days: parseFloat(certExpiry.toFixed(1)),
          cert_status: node.status === 'UP' ? 1 : 0,
          sync_status: node.status === 'UP' ? 1 : 0,
          sent_messages_total: esSentTotal[node.id],
          received_messages_total: esReceivedTotal[node.id],
          is_down: node.status === 'DOWN',
        };
        operations.push({ index: { _index: ES_INDEX } }, doc);
      } else if (node.type === 'broker') {
        const doc = {
          '@timestamp': timestamp,
          doc_type: 'broker',
          broker_name: node.name,
          broker_instance: node.instance,
          broker_status: node.status === 'UP' ? 1 : 0,
          is_down: node.status === 'DOWN',
        };
        operations.push({ index: { _index: ES_INDEX } }, doc);
      }
    }

    try {
      await esClient.bulk({ operations });
    } catch (err) {
      // ES may not be ready yet — silent retry on next tick
    }
  }

  // Start ES pusher after a short delay to allow ES to boot
  setTimeout(async () => {
    await ensureESIndex();
    setInterval(pushMetricsToES, 10000);
    console.log(`[ES] Pushing metrics to ${ES_URL}/${ES_INDEX} every 10s`);
  }, 15000);

  // ── Broadcast SSE ──
  function broadcast() {
    const now = Date.now();
    const activeMessages = messages.map(m => ({
      ...m,
      progress: Math.min(1, Math.max(0, (now - m.startTime) / m.duration)),
    }));
    const data = JSON.stringify({ nodes, links, messages: activeMessages });
    clients.forEach(c => c.write(`data: ${data}\n\n`));
  }

  // ── Visual message animation loop ──
  // Gauche → Droite ou Droite → Gauche : via broker-b (central)
  // Gauche → Gauche : via broker-a
  // Droite → Droite : via broker-c
  const leftEcpIds = new Set(['ecp-fr', 'ecp-de']);
  const rightEcpIds = new Set(['ecp-es', 'ecp-it', 'ecp-be']);

  setInterval(() => {
    const ecps = nodes.filter(n => n.type === 'ecp');
    const source = ecps[Math.floor(Math.random() * ecps.length)];
    let target = ecps[Math.floor(Math.random() * ecps.length)];
    while (target.id === source.id) {
      target = ecps[Math.floor(Math.random() * ecps.length)];
    }

    let brokerId: string;
    if (leftEcpIds.has(source.id) && rightEcpIds.has(target.id)) brokerId = 'broker-b';
    else if (rightEcpIds.has(source.id) && leftEcpIds.has(target.id)) brokerId = 'broker-b';
    else if (leftEcpIds.has(source.id)) brokerId = 'broker-a';
    else brokerId = 'broker-c';

    const path = [source.id, brokerId, target.id];
    const isUp = path.every(nId => nodes.find(n => n.id === nId)?.status === 'UP');

    messages.push({
      id: Math.random().toString(36).substring(7),
      source: source.id,
      target: target.id,
      path,
      status: isUp ? 'success' : 'failed',
      startTime: Date.now(),
      duration: path.length * 1000,
      progress: 0,
    });

    const now = Date.now();
    messages = messages.filter(m => now - m.startTime < m.duration + 2000);
  }, 2000);

  setInterval(broadcast, 100);

  // ── API Routes ──
  app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });

  app.get('/api/state', (_req, res) => {
    res.json({ nodes, links, messages });
  });

  app.get('/api/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    clients.push(res);
    res.write(`data: ${JSON.stringify({ nodes, links, messages })}\n\n`);
    req.on('close', () => { clients = clients.filter(c => c !== res); });
  });

  app.post('/api/nodes/:id/toggle', (req, res) => {
    const node = nodes.find(n => n.id === req.params.id);
    if (!node) return res.status(404).json({ error: 'Node not found' });

    node.status = node.status === 'UP' ? 'DOWN' : 'UP';

    const upBrokers = nodes.filter(n => n.type === 'broker' && n.status === 'UP').length;

    if (node.type === 'ecp') {
      const l = ecpLabelsOf(node);
      if (node.status === 'DOWN') {
        connectedBrokers.set(l, 0);
        certStatus.set(l, 0);
        syncStatus.set(l, 0);
      } else {
        connectedBrokers.set(l, upBrokers);
        certStatus.set(l, 1);
        syncStatus.set(l, 1);
      }
    }

    if (node.type === 'broker') {
      brokerStatus.set(
        { broker_name: node.name, broker_instance: node.instance! },
        node.status === 'UP' ? 1 : 0
      );
    }

    broadcast();
    res.json({ success: true, node });
  });

  app.post('/api/nodes/:id/cert', (req, res) => {
    const node = nodes.find(n => n.id === req.params.id);
    if (!node || node.type !== 'ecp') return res.status(404).json({ error: 'Node not found or not ECP' });

    node.certExpiry = req.body.days;
    certExpiration.set(ecpLabelsOf(node), node.certExpiry);
    broadcast();
    res.json({ success: true, node });
  });

  // ── Vite / Static ──
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ECP Simulator Endpoint running on http://localhost:${PORT}`);
    console.log(`Prometheus metrics available on http://localhost:${PORT}/metrics`);
  });
}

startServer();
