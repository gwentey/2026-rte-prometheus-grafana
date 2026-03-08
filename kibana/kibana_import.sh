#!/bin/sh
# Script d'initialisation Kibana : data view + visualisations + dashboards
# Attend que Kibana soit prêt avant d'importer

KIBANA_URL="http://kibana:5601"
TEMPLATES_DIR="/kibana/templates"

wait_for_kibana() {
  echo "[kibana-setup] Attente de Kibana..."
  until curl -s -o /dev/null -w "%{http_code}" "${KIBANA_URL}/api/status" | grep -q "200"; do
    sleep 5
  done
  # Attente supplémentaire pour que l'initialisation interne de Kibana se termine
  sleep 10
  echo "[kibana-setup] Kibana est prêt."
}

wait_for_es() {
  echo "[kibana-setup] Attente d'Elasticsearch..."
  until curl -s -o /dev/null -w "%{http_code}" "http://elasticsearch:9200/_cluster/health" | grep -q "200"; do
    sleep 5
  done
  echo "[kibana-setup] Elasticsearch est prêt."
}

create_data_view() {
  echo "[kibana-setup] Création du data view ecp-metrics..."
  curl -s -X POST "${KIBANA_URL}/api/data_views/data_view" \
    -H "kbn-xsrf: true" \
    -H "Content-Type: application/json" \
    -d @"${TEMPLATES_DIR}/data_view.json"
  echo ""
}

create_vis() {
  local id="$1"
  local file="$2"
  echo "[kibana-setup] Création visualisation: ${id}..."
  curl -s -X POST "${KIBANA_URL}/api/saved_objects/lens/${id}?overwrite=true" \
    -H "kbn-xsrf: true" \
    -H "Content-Type: application/json" \
    -d @"${TEMPLATES_DIR}/${file}"
  echo ""
}

create_dashboard() {
  local id="$1"
  local file="$2"
  echo "[kibana-setup] Création dashboard: ${id}..."
  curl -s -X POST "${KIBANA_URL}/api/saved_objects/dashboard/${id}?overwrite=true" \
    -H "kbn-xsrf: true" \
    -H "Content-Type: application/json" \
    -d @"${TEMPLATES_DIR}/${file}"
  echo ""
}

# ── Main ──
wait_for_es
wait_for_kibana

create_data_view

# Visualisations dashboard global
create_vis "ecp-vis-status"  "vis-ecp-status.json"
create_vis "ecp-vis-heap"    "vis-heap.json"
create_vis "ecp-vis-waiting" "vis-waiting.json"
create_vis "ecp-vis-brokers" "vis-brokers.json"
create_vis "ecp-vis-certs"   "vis-certs.json"
create_vis "ecp-vis-messages" "vis-messages.json"

# Visualisations dashboard détail
create_vis "ecp-det-status"  "vis-det-status.json"
create_vis "ecp-det-heap"    "vis-det-heap.json"
create_vis "ecp-det-cpu"     "vis-det-cpu.json"
create_vis "ecp-det-threads" "vis-det-threads.json"
create_vis "ecp-det-queues"  "vis-det-queues.json"

# Dashboards
create_dashboard "ecp-global-kb" "dashboard-global.json"
create_dashboard "ecp-detail-kb" "dashboard-detail.json"

echo "[kibana-setup] Import terminé."
echo "[kibana-setup] Dashboard Global  : ${KIBANA_URL}/app/dashboards#/view/ecp-global-kb"
echo "[kibana-setup] Dashboard Detail  : ${KIBANA_URL}/app/dashboards#/view/ecp-detail-kb"
