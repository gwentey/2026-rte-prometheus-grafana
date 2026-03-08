# POC Supervision réseau ECP — Prometheus/Grafana vs ELK/Kibana

## Architecture globale

```
[ecp-network-monitor :4000]
       │
       ├─── /metrics (pull 10s) ──────▶ [Prometheus :9090] ──▶ [Grafana :3000]
       │
       └─── push JSON (10s) ──────────▶ [Elasticsearch :9200] ──▶ [Kibana :5601]
```

Les deux stacks reçoivent les mêmes données à la même fréquence (10 secondes) afin de permettre une comparaison objective.

## Lancer le projet

```bash
docker-compose up --build -d
```

> Le flag `--build` est nécessaire au premier lancement pour construire l'image `ecp-network-monitor`.

## Accès aux interfaces

| Service | URL | Identifiants |
|---|---|---|
| ECP Network Monitor | http://localhost:4000 | — |
| Prometheus | http://localhost:9090 | — |
| Grafana | http://localhost:3000 | admin / admin |
| Elasticsearch | http://localhost:9200 | — |
| Kibana | http://localhost:5601 | — |

Les dashboards Kibana sont importés automatiquement au démarrage par le service `kibana-setup` (~60s après le boot initial d'ES/Kibana).

## Métriques exposées

### Prometheus (`/metrics` — format text/plain)

| Métrique | Type | Description |
|---|---|---|
| `ecp_endpoint_connected_brokers` | Gauge | Brokers connectés à l'ECP |
| `ecp_endpoint_connected_broken_brokers` | Gauge | Brokers en erreur |
| `ecp_endpoint_waiting_to_deliver_messages` | Gauge | Files d'attente livraison |
| `ecp_endpoint_waiting_to_receive_messages` | Gauge | Files d'attente réception |
| `ecp_endpoint_certificate_closest_expiration` | Gauge | Jours avant expiration cert |
| `ecp_endpoint_certificates_status` | Gauge | Validité TLS (0/1) |
| `ecp_endpoint_synchronization_status` | Gauge | Sync Component Directory (0/1) |
| `jvm_memory_used_bytes` | Gauge | Heap JVM utilisée |
| `jvm_memory_max_bytes` | Gauge | Heap JVM max |
| `process_cpu_usage` | Gauge | CPU process Java |
| `jvm_threads_live_threads` | Gauge | Threads actifs |
| `ecp_endpoint_sent_messages_total` | Counter | Messages envoyés (cumulé) |
| `ecp_endpoint_received_messages_total` | Counter | Messages reçus (cumulé) |
| `ecp_broker_status` | Gauge | Statut broker (1=OK, 0=ERREUR) |

### Elasticsearch (index `ecp-metrics` — documents JSON)

Chaque document contient les mêmes valeurs que Prometheus, enrichies :

```json
{
  "@timestamp": "2025-01-15T10:30:00.000Z",
  "doc_type": "ecp",
  "ecp_name": "ECP-GRT-FR",
  "location": "Paris",
  "instance": "localhost:8000",
  "heap_used_bytes": 134217728,
  "heap_max_bytes": 536870912,
  "heap_used_pct": 73.2,
  "cpu_usage": 18.5,
  "threads": 62,
  "connected_brokers": 2,
  "broken_brokers": 0,
  "waiting_deliver": 12,
  "waiting_receive": 5,
  "cert_expiry_days": 45.0,
  "cert_status": 1,
  "sync_status": 1,
  "sent_messages_total": 1452,
  "received_messages_total": 1389,
  "is_down": false
}
```

---

# Rapport comparatif — Prometheus/Grafana vs ELK/Kibana

## 1. Modèle d'ingestion des données

### Prometheus/Grafana — Modèle Pull

Prometheus **scrape** périodiquement l'endpoint `/metrics` exposé par l'application. L'application n'a pas à connaître l'adresse de Prometheus.

```
Prometheus ──scrape toutes les 10s──▶ /metrics (text/plain)
```

**Avantages du pull :**
- Prometheus contrôle la fréquence et peut détecter si l'app est DOWN (absence de scrape = alerte)
- Aucune dépendance réseau côté application vers Prometheus
- Configuration centralisée dans `prometheus.yml`
- Service discovery natif (Kubernetes, Consul, EC2...)

**Inconvénients :**
- L'application doit exposer un endpoint HTTP `/metrics` accessible par Prometheus
- Perte des événements entre deux scrapes (micro-pics non capturés)
- Scalabilité limitée à très haut débit (millions de métriques) sans fédération ou Thanos

### ELK/Kibana — Modèle Push

L'application pousse activement des documents JSON vers Elasticsearch toutes les 10 secondes.

```
Application ──push JSON toutes les 10s──▶ Elasticsearch
```

**Avantages du push :**
- Pas besoin d'exposer un port HTTP supplémentaire depuis l'application
- Chaque événement peut être enrichi avec un contexte métier avant envoi
- Adapté aux environnements où l'application n'est pas accessible depuis le serveur de monitoring (NAT, firewalls)
- Bulk indexing très performant pour de gros volumes

**Inconvénients :**
- L'application dépend de la disponibilité d'Elasticsearch (couplage réseau)
- La gestion des erreurs de push (ES indisponible) doit être implémentée côté app
- Pas de détection automatique de panne applicative (ES ne sait pas si l'app est DOWN ou simplement silencieuse)

---

## 2. Modèle de données

### Prometheus — TSDB (Time Series Database)

Prometheus stocke des **séries temporelles** sous la forme `métrique{labels} → [(timestamp, value)]`. Chaque série est identifiée par son nom + un ensemble de labels clé/valeur.

**Caractéristiques :**
- Optimisé pour la lecture d'intervalles temporels (range queries)
- Stockage compact par compression de chunks
- Rétention configurable (par défaut 15 jours)
- Pas conçu pour stocker des chaînes, des logs, ou des documents structurés complexes
- Cardinalité des labels : attention aux explosions de cardinalité (trop de valeurs uniques par label = problèmes de perf)

**Exemple de stockage :**
```
ecp_endpoint_connected_brokers{ecp_name="ECP-GRT-FR", location="Paris", instance="localhost:8000"} → [(t1, 2), (t2, 2), (t3, 0)]
```

### Elasticsearch — Store de documents JSON

Elasticsearch indexe des **documents JSON arbitraires** dans un index inversé. Chaque document contient un `@timestamp` qui permet les requêtes temporelles.

**Caractéristiques :**
- Modèle flexible : schéma évolutif, champs libres, types mixtes
- Index inversé : full-text search + agrégations analytiques
- Adapté aux logs, traces, métriques, et données structurées complexes
- Un document = un snapshot complet de l'état à un instant T (tous les champs ECP)
- Rétention gérée via ILM (Index Lifecycle Management) : hot/warm/cold/delete

**Exemple de stockage :**
```json
{"@timestamp": "...", "ecp_name": "ECP-GRT-FR", "connected_brokers": 2, "heap_used_pct": 73.2, ...}
```

---

## 3. Langages de requête

### PromQL (Prometheus Query Language)

PromQL est un langage **fonctionnel spécialisé pour les métriques temporelles**.

**Exemples utilisés dans les dashboards Grafana :**

```promql
# Heap JVM %
(jvm_memory_used_bytes{area="heap"} / jvm_memory_max_bytes{area="heap"}) * 100

# Taux de messages sur 2 minutes
increase(ecp_endpoint_sent_messages_total[2m])

# Brokers en erreur (filtre)
ecp_broker_status{broker_name=~"BROKER.*"}
```

**Points forts :**
- `rate()`, `increase()`, `delta()` : calcul de dérivées sur les Counters en natif
- `histogram_quantile()` : calcul de percentiles depuis des histogrammes
- Opérations vectorielles : addition, division, `by()`, `on()` pour joindre des séries
- Subqueries pour agréger sur des sous-intervalles temporels

**Limites :**
- Syntaxe très spécifique, courbe d'apprentissage steep pour les non-initiés
- Pas de full-text search ni de requêtes sur des champs string complexes
- Pas adapté aux données non-numériques

### KQL + ES DSL (Kibana / Elasticsearch)

Kibana utilise **KQL (Kibana Query Language)** pour les filtres simples, et **ES Aggregations DSL** pour les calculs analytiques via Lens/TSVB.

**Exemples de filtres KQL :**

```kql
doc_type: "ecp" AND ecp_name: "ECP-GRT-FR"
is_down: false AND cert_expiry_days < 30
```

**Équivalent Elasticsearch DSL pour les agrégations :**
```json
{
  "aggs": {
    "by_ecp": {
      "terms": {"field": "ecp_name"},
      "aggs": {
        "avg_heap": {"avg": {"field": "heap_used_pct"}},
        "over_time": {
          "date_histogram": {"field": "@timestamp", "calendar_interval": "1m"}
        }
      }
    }
  }
}
```

**Points forts :**
- Full-text search sur n'importe quel champ string
- Agrégations complexes : nested, scripted, bucket_script, moving_avg
- `derivative` et `serial_diff` pour les incréments de Counters
- Adapté aux logs, aux traces et aux données hétérogènes

**Limites :**
- Pour reproduire `increase()` de Prometheus, il faut utiliser `derivative` ou calculer manuellement la différence entre deux valeurs → moins précis et plus complexe
- Le calcul de percentiles depuis des histogrammes est possible mais nécessite un pipeline d'agrégation plus verbeux
- KQL est simple pour les filtres mais ne permet pas d'exprimer des calculs complexes directement

---

## 4. Capacités des dashboards

### Grafana

| Fonctionnalité | Support |
|---|---|
| Time series avec seuils colorés | Natif, très flexible |
| Stat panels avec couleur de fond | Natif |
| Gauge circulaire | Natif |
| Variables template dynamiques (`label_values()`) | Natif, refresh automatique |
| Annotations d'événements | Natif (depuis Prometheus ou datasource externe) |
| Alerting natif dans le dashboard | Oui (Grafana Alerting depuis v9) |
| Transformations de données | Rename, calculate field, merge, group by |
| Plugins communautaires | Très riche : network map (`esnet-networkmap-panel`), etc. |
| Export PDF / PNG | Oui (Grafana Enterprise ou plugin) |
| Provisioning as code | Oui — JSON via `grafana/provisioning/` |
| Datasources multiples dans un même panel | Non |

**Avantage Grafana :** L'écosystème de plugins est extrêmement riche (plus de 150 plugins officiels). La gestion des variables template (ex: `$ecp_instance` qui se peuple dynamiquement depuis les labels Prometheus) est particulièrement puissante et sans équivalent natif dans Kibana.

### Kibana (Lens)

| Fonctionnalité | Support |
|---|---|
| Time series (line, area, bar) | Natif via Lens |
| Metric cards avec couleur conditionnelle | Natif via Lens Metric |
| Gauge | Natif via Lens Gauge |
| Controls panel (filtres dynamiques) | Natif — Options List, Range Slider |
| Annotations | Oui (via annotations d'index) |
| Alerting natif | Oui — Kibana Alerting (Observability) |
| Transformations | Formulas Lens (add, subtract, math) |
| Machine Learning | Oui — anomaly detection intégrée (X-Pack) |
| Full-text search dans les panels | Oui — unique à ELK |
| Canvas (rapports visuels) | Oui |
| Export PDF | Oui (reporting X-Pack) |
| Provisioning as code | Non natif — via API saved objects uniquement |
| Datasources multiples | Non (limité à ES/OpenSearch) |

**Avantage Kibana :** L'intégration avec le Machine Learning Elastic permet de détecter des anomalies automatiquement sur les séries temporelles sans configuration manuelle de seuils. La possibilité de faire des recherches full-text sur les logs dans le même outil que les métriques est un avantage majeur pour le diagnostic.

---

## 5. Alerting

### Prometheus/Grafana
- **Prometheus Alertmanager** : règles d'alerte exprimées en PromQL dans des fichiers YAML
- **Grafana Alerting** : interface visuelle pour créer des alertes, supporte de multiples datasources
- Notification vers : Slack, PagerDuty, email, webhook, OpsGenie...
- **Force** : les alertes PromQL sont très précises grâce à `rate()`, `absent()`, `for:` (durée minimum)
- **Limite** : la gestion des silences et de la déduplication est complexe sans Alertmanager bien configuré

### ELK/Kibana
- **Kibana Alerting** : règles visuelles basées sur des requêtes ES/KQL
- **Elastic Observability** : alertes prédictives basées sur ML (anomaly detection)
- Notification vers : Slack, email, PagerDuty, webhook, JIRA...
- **Force** : alertes sur des données textuelles et logs (ex: "si ERROR apparaît > 100 fois en 5min")
- **Limite** : les alertes sur des Counters (dérivées) sont moins précises qu'avec `increase()` de Prometheus

---

## 6. Consommation de ressources

| Composant | RAM recommandée | CPU (idle) | Stockage |
|---|---|---|---|
| Prometheus | ~512 MB | Faible | ~2 GB/mois pour 100 séries |
| Grafana | ~256 MB | Très faible | Négligeable (pas de données) |
| **Total stack Prometheus** | **~768 MB** | Faible | ~2 GB/mois |
| Elasticsearch | 1-2 GB minimum (JVM heap) | Modéré | ~5-20 GB/mois selon volume |
| Kibana | ~1 GB | Modéré | Négligeable |
| **Total stack ELK** | **~2-3 GB** | Modéré | ~5-20 GB/mois |

> **Note :** Dans ce POC, ES est configuré avec `-Xms512m -Xmx512m` pour un environnement local. En production, la recommandation Elastic est d'allouer 50% de la RAM disponible à la JVM (minimum 4 GB).

**Conclusion :** La stack Prometheus+Grafana est **2 à 4× plus légère** en ressources. Sur un serveur de supervision dédié modeste (4 GB RAM), Prometheus+Grafana fonctionne sans contrainte, tandis qu'Elasticsearch nécessite un dimensionnement plus soigné.

---

## 7. Scalabilité

### Prometheus/Grafana

**Architecture native single-node :**
- Prometheus est monolithique par conception (single writer)
- Scalabilité verticale jusqu'à ~10 millions de séries actives par instance
- Scalabilité horizontale : **fédération** (agrégation de multiples Prometheus) ou **Thanos/Cortex/Mimir** (long-term storage distribué, HA, multi-tenant)
- Grafana peut interroger plusieurs datasources Prometheus simultanément

**Cas d'usage :**
- Excellent pour la supervision infra/applicative à l'échelle d'une entreprise (100k séries)
- Limite : pas conçu pour stocker des logs ou des données non-numériques

### ELK/Kibana

**Architecture distribuée native :**
- Elasticsearch est conçu pour la scalabilité horizontale dès le départ (shards, replicas)
- Un cluster ES peut gérer des **milliards de documents** répartis sur des dizaines de nœuds
- ILM (Index Lifecycle Management) pour gérer hot/warm/cold/delete automatiquement
- Elastic Cloud et ECK (Elastic Cloud on Kubernetes) pour le déploiement managé

**Cas d'usage :**
- Adapté aux plateformes Big Data, SOC (Security Operations), compliance logging
- Peut centraliser métriques + logs + traces (Elastic APM) dans un seul cluster

---

## 8. Intégration dans un écosystème

### Prometheus/Grafana

| Intégration | Disponibilité |
|---|---|
| Kubernetes (kube-state-metrics, node-exporter) | Natif, très mature |
| OpenTelemetry (OTLP) | Oui (via Prometheus Remote Write) |
| Exporters tiers (MySQL, Redis, NGINX...) | +800 exporters officiels |
| Grafana LGTM (Logs+Metrics+Traces) | Stack complète avec Loki + Tempo |
| GitOps / Infrastructure as Code | Excellent (tout en YAML/JSON) |

### ELK/Kibana

| Intégration | Disponibilité |
|---|---|
| Beats (Filebeat, Metricbeat, Packetbeat...) | Natif Elastic |
| OpenTelemetry (OTLP) | Oui (Elastic APM / EDOT) |
| Logstash pipelines | Très riche (500+ plugins) |
| SIEM / Security | Elastic Security (règles MITRE ATT&CK) |
| APM (Application Performance Monitoring) | Natif Elastic APM |
| Kubernetes (ECK) | Opérateur Kubernetes officiel |

---

## 9. Courbe d'apprentissage

| Aspect | Prometheus/Grafana | ELK/Kibana |
|---|---|---|
| Installation initiale | Simple (2 services) | Modérée (ES nécessite tuning JVM) |
| Premier dashboard | 15-30 min | 30-60 min |
| Maîtrise de PromQL | 1-2 semaines | N/A |
| Maîtrise de KQL/ES DSL | N/A | 1-3 semaines |
| Alerting configuration | Modérée (YAML) | Modérée (interface UI) |
| Administration cluster | Facile (single-node) | Complexe (shards, ILM, snapshots) |
| Documentation officielle | Excellente | Excellente |

---

## 10. Tableau de synthèse et recommandations

| Critère | Prometheus/Grafana | ELK/Kibana | Avantage |
|---|---|---|---|
| **Supervision métriques numériques** | Excellent | Bon | Prometheus |
| **Analyse de logs** | Limité (Loki requis) | Excellent | ELK |
| **Traces APM** | Limité (Tempo requis) | Intégré (APM) | ELK |
| **Ressources serveur** | Légères (~768 MB) | Lourdes (~2-3 GB) | Prometheus |
| **Scalabilité** | Verticale + fédération | Horizontale native | ELK |
| **Dashboards temps réel** | Excellent (30s refresh) | Bon (30s refresh) | Égalité |
| **Alerting sur métriques** | Excellent (PromQL précis) | Bon | Prometheus |
| **Alerting sur logs** | Non natif | Excellent | ELK |
| **Machine Learning / Anomalies** | Non natif | Intégré (X-Pack) | ELK |
| **Richesse des plugins** | Très riche (Grafana) | Riche | Prometheus |
| **Variables template dynamiques** | Excellent | Bon (Controls) | Prometheus |
| **Full-text search** | Non | Excellent | ELK |
| **Coût licences** | 100% open source | Open Source / X-Pack payant | Prometheus |
| **Provisioning as code** | Excellent | Partiel (API) | Prometheus |
| **Courbe d'apprentissage** | Modérée | Plus élevée | Prometheus |

### Recommandation pour le POC ECP

**Si l'objectif est uniquement la supervision de métriques numériques d'infrastructure :**
→ **Prometheus + Grafana** est le choix optimal. La stack est plus légère, PromQL est précis pour les Counters/Gauges, et les dashboards Grafana sont plus riches en termes de plugins (notamment le `esnet-networkmap-panel` utilisé ici). Le coût opérationnel est moindre.

**Si l'objectif inclut :**
- La centralisation des logs applicatifs (events ECP, erreurs, audit trails)
- La recherche full-text dans les événements
- La détection d'anomalies automatique
- L'APM (traces de transactions ECP end-to-end)

→ **ELK + Kibana** est plus adapté, éventuellement en complément de Prometheus pour les métriques pures.

**Cas idéal (architecture hybride) :**
```
Application ECP
    ├── /metrics ──▶ Prometheus ──▶ Grafana (métriques temps réel)
    ├── logs JSON ──▶ Filebeat ──▶ Elasticsearch ──▶ Kibana (logs + anomalies)
    └── traces ──▶ Elastic APM (traces end-to-end)
```

---

## Développement local (sans Docker)

```bash
cd ecp-network-monitor
npm install
npm run dev
```

L'app sera disponible sur http://localhost:4000. Pour le mode sans Docker, l'app tentera de se connecter à Elasticsearch sur `http://elasticsearch:9200` (échec silencieux si ES n'est pas disponible — les métriques Prometheus continuent de fonctionner normalement).

Pour pointer vers un ES local :
```bash
ELASTICSEARCH_URL=http://localhost:9200 npx tsx server.ts
```
