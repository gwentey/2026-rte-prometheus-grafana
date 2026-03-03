import time
import random
import math
from prometheus_client import start_http_server, Gauge, Counter, REGISTRY, PROCESS_COLLECTOR, PLATFORM_COLLECTOR

# Désactiver les métriques Python par défaut (on veut juste les métriques ECP)
REGISTRY.unregister(PROCESS_COLLECTOR)
REGISTRY.unregister(PLATFORM_COLLECTOR)

# ─────────────────────────────────────────────
# MÉTRIQUES ECP ENDPOINT (Gauges — valeurs instantanées)
# ─────────────────────────────────────────────
labels = ['ecp_name', 'location', 'instance']

cert_status = Gauge('ecp_endpoint_certificates_status', 'Validité des certificats TLS', labels)
sync_status = Gauge('ecp_endpoint_synchronization_status', 'Sync avec Component Directory', labels)
connected_brokers = Gauge('ecp_endpoint_connected_brokers', 'Nombre de brokers connectés', labels)
broken_brokers = Gauge('ecp_endpoint_connected_broken_brokers', 'Brokers en erreur', labels)
waiting_deliver = Gauge('ecp_endpoint_waiting_to_deliver_messages', 'Messages en attente livraison', labels)
waiting_receive = Gauge('ecp_endpoint_waiting_to_receive_messages', 'Messages en attente reception', labels)
messages_store = Gauge('ecp_endpoint_messages_in_store', 'Messages dans le store', labels)
live_messages = Gauge('ecp_endpoint_live_messages_in_store', 'Messages non finalisés', labels)
reloading = Gauge('ecp_endpoint_reloading', 'Rechargement en cours', labels)
cert_expiration = Gauge('ecp_endpoint_certificate_closest_expiration', 'Jours avant expiration certificat', labels)
no_valid_path = Gauge('ecp_endpoint_is_without_valid_path', 'Absence de message path valide', labels)

# Counters — valeurs cumulées (toujours croissantes)
sent_messages = Counter('ecp_endpoint_sent_messages', 'Messages envoyés (cumulé)', labels)
received_messages = Counter('ecp_endpoint_received_messages', 'Messages reçus (cumulé)', labels)

# Job success
job_success = Gauge('ecp_endpoint_job_success', 'Succès du dernier job planifié', labels + ['job'])

# ─────────────────────────────────────────────
# MÉTRIQUES JVM (simulées comme Spring Boot Actuator)
# ─────────────────────────────────────────────
jvm_heap_used = Gauge('jvm_memory_used_bytes', 'Heap JVM utilisée', labels + ['area'])
jvm_heap_max = Gauge('jvm_memory_max_bytes', 'Heap JVM max', labels + ['area'])
process_cpu = Gauge('process_cpu_usage', 'CPU du process Java', labels)
jvm_threads = Gauge('jvm_threads_live_threads', 'Threads actifs', labels)

# ─────────────────────────────────────────────
# INSTANCES ECP À SIMULER
# ─────────────────────────────────────────────
ECP_INSTANCES = [
    {'ecp_name': 'ECP-GRT-FR',  'location': 'Paris',    'instance': 'localhost:8000'},
    {'ecp_name': 'ECP-GRT-DE',  'location': 'Berlin',   'instance': 'localhost:8001'},
    {'ecp_name': 'ECP-GRT-ES',  'location': 'Madrid',   'instance': 'localhost:8002'},
    {'ecp_name': 'ECP-GRT-IT',  'location': 'Rome',     'instance': 'localhost:8003'},
    {'ecp_name': 'ECP-GRT-BE',  'location': 'Brussels', 'instance': 'localhost:8004'},
]

def update_metrics():
    t = time.time()
    for ecp in ECP_INSTANCES:
        l = [ecp['ecp_name'], ecp['location'], ecp['instance']]

        # Simuler des oscillations réalistes avec des sinus + bruit
        noise = random.uniform(-0.05, 0.05)

        # Heap JVM : oscille entre 60% et 90% (512MB max)
        heap_max_bytes = 512 * 1024 * 1024
        heap_ratio = 0.72 + 0.15 * math.sin(t / 60) + noise
        heap_ratio = max(0.3, min(0.98, heap_ratio))
        jvm_heap_used.labels(*(l + ['heap'])).set(heap_max_bytes * heap_ratio)
        jvm_heap_max.labels(*(l + ['heap'])).set(heap_max_bytes)

        # CPU : entre 5% et 40%
        cpu = 0.15 + 0.12 * math.sin(t / 45) + noise
        process_cpu.labels(*l).set(max(0.01, min(0.99, cpu)))

        # Threads : entre 40 et 80
        jvm_threads.labels(*l).set(int(55 + 15 * math.sin(t / 90)))

        # Statuts (1=OK, 0=KO) — en général UP
        cert_status.labels(*l).set(1)
        sync_status.labels(*l).set(1)

        # Brokers : 3 connectés, rarement un en erreur
        connected_brokers.labels(*l).set(3)
        broken_brokers.labels(*l).set(1 if random.random() < 0.05 else 0)

        # Messages en attente : pic toutes les ~2 min pour simuler congestion
        congestion = abs(40 * math.sin(t / 120))
        waiting_deliver.labels(*l).set(int(congestion + random.uniform(0, 10)))
        waiting_receive.labels(*l).set(int(random.uniform(0, 20)))

        # Store
        messages_store.labels(*l).set(int(random.uniform(5, 50)))
        live_messages.labels(*l).set(int(random.uniform(0, 10)))

        # Rechargement : jamais en cours (sauf rare)
        reloading.labels(*l).set(1 if random.random() < 0.02 else 0)

        # Certificat : expire dans 45 jours (WARNING si < 30)
        cert_expiration.labels(*l).set(45 + random.uniform(-5, 5))

        # Path valide : toujours OK
        no_valid_path.labels(*l).set(0)

        # Counters : incrémenter régulièrement
        sent_messages.labels(*l).inc(random.randint(0, 5))
        received_messages.labels(*l).inc(random.randint(0, 4))

        # Jobs planifiés
        for job in ['certRenewal', 'syncCD', 'cleanStore']:
            job_success.labels(*(l + [job])).set(1 if random.random() > 0.02 else 0)

if __name__ == '__main__':
    # Exposer sur /metrics port 8000
    start_http_server(8004)
    print("ECP Simulator démarré sur http://localhost:8004/metrics")
    print("Simule 5 ECP : FR, DE, ES, IT, BE")
    print("Ctrl+C pour arrêter")
    while True:
        update_metrics()
        time.sleep(5)
