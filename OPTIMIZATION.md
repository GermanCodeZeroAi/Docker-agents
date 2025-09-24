# OPTIMIZATION.md - Senior Review & Härtungsempfehlungen

## Status: Kritische Analyse der aktuellen Infrastruktur

### Identifizierte Lücken und Widersprüche

#### 1. Fehlende Service-Härtung
- **Healthchecks fehlen komplett**: Alle Services laufen ohne Gesundheitsprüfungen
- **Keine Ressourcengrenzen**: Container können unbegrenzt CPU/Memory verbrauchen
- **Restart-Policy inkonsistent**: `unless-stopped` überall, aber keine differenzierte Strategie
- **Missing Readiness/Liveness**: Kubernetes-Style Probes fehlen für Service-Abhängigkeiten

#### 2. Security-Schwachstellen
- **Plain-Text Secrets**: Alle DB-Passwörter als ENV-Variablen in compose.yml sichtbar
- **Root-Container**: Alle Services laufen als root (Privilegien-Eskalation möglich)
- **Offene Ports ohne Filterung**: Prometheus (9090), Grafana (3000) etc. ohne Netzwerk-Segmentierung
- **Keine Secret-Rotation**: Statische Credentials ohne Ablaufmechanismus

#### 3. Backup & Persistence-Risiken
- **Backup-Job ohne Fehlerbehandlung**: `pg_dump` kann fehlschlagen ohne Notification
- **Keine Backup-Rotation**: Unbegrenzte Backup-Akkumulation
- **Missing Volume-Permissions**: Keine expliziten UID/GID für persistente Daten
- **Backup-Timing kritisch**: 24h-Intervall ohne Overlap-Protection

#### 4. Monitoring-Gaps
- **Loki ohne Retention**: Logs akkumulieren unbegrenzt
- **Fehlende Service-Discovery**: Prometheus-Targets hart kodiert
- **Keine Alerting-Rules**: Kritische Zustände bleiben unbemerkt
- **Log-Leakage**: Sensitive Daten in Logs ohne Scrubbing

#### 5. Performance & Resource-Management
- **Ollama-Integration unoptimiert**: Keine DirectML/CPU-spezifische Konfiguration
- **DB-Connection-Pools**: Keine Limits für PostgreSQL-Verbindungen
- **Memory-Leaks potentiell**: Node.js Services ohne Memory-Monitoring
- **Disk-Space-Management**: Keine automatische Cleanup-Mechanismen

### Konkrete Nachschärfungen

#### Service-Härtung
```yaml
# Beispiel für verbesserte Service-Definition
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 60s

deploy:
  resources:
    limits:
      memory: 512M
      cpus: '0.5'
    reservations:
      memory: 256M
      cpus: '0.25'

restart: on-failure:3
```

#### Security-Härtung
- **Docker Secrets**: Alle Passwörter über Docker Secrets statt ENV
- **Non-Root Users**: Dedizierte UIDs (1001-1010) für jeden Service
- **Network Policies**: Segmentierung zwischen Frontend/Backend/Monitoring
- **Read-Only Filesystems**: Wo möglich, Container mit `read_only: true`

#### Backup-Verbesserungen
```bash
# Gehärteter Backup-Command
bash -c "
  BACKUP_FILE=/backups/backup-$(date +%F-%H%M).sql
  if pg_dump -h postgres -U \$POSTGRES_USER \$POSTGRES_DB > \$BACKUP_FILE 2>/dev/null; then
    echo \"$(date): Backup successful: \$BACKUP_FILE\" >> /backups/backup.log
    find /backups -name '*.sql' -mtime +7 -delete
    exit 0
  else
    echo \"$(date): Backup failed\" >> /backups/backup.log
    exit 1
  fi
"
```

#### Monitoring-Verbesserungen
- **Prometheus Retention**: `--storage.tsdb.retention.time=30d`
- **Loki Retention**: `retention_period: 720h` (30 Tage)
- **Alertmanager**: Kritische Service-Alerts für Backup-Failures
- **Log-Scrubbing**: Regex für Email-Adressen, Passwörter in Promtail

#### Performance-Optimierungen für DirectML/CPU
```yaml
# Ollama-spezifische Hints für Services
environment:
  - OLLAMA_NUM_PARALLEL=2
  - OLLAMA_MAX_LOADED_MODELS=1
  - OLLAMA_FLASH_ATTENTION=false
  - NODE_OPTIONS=--max-old-space-size=512
```

### Verfeinerte Akzeptanzkriterien

#### Service-Availability
- **Startup-Zeit**: Alle Services < 60s bis healthy
- **Backup-SLA**: 99% erfolgreiche tägliche Backups über 30 Tage
- **Recovery-Time**: < 5min für Service-Restart nach Failure
- **Health-Check Budget**: Max 3 consecutive failures vor Restart

#### Exit-Codes & Monitoring
- **Backup-Job**: Exit 0 = Success, Exit 1 = DB-Error, Exit 2 = Disk-Full
- **Mailer-Services**: Exit 0 = Clean shutdown, Exit 1 = Config-Error, Exit 2 = Connection-Error
- **Prometheus Scraping**: 95% successful scrapes über 24h

#### Performance-Benchmarks
- **Email-Processing**: < 5s pro Email (ohne Ollama), < 30s (mit Ollama)
- **DB-Query-Performance**: < 100ms für Standard-Queries
- **Dashboard-Load**: Grafana < 3s für Standard-Dashboards

### Testkommandos (einzeilig, nachvollziehbar)

#### Infrastructure-Tests
```bash
# Test 1: Service Health Check
docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" | grep -v "Up.*healthy" && echo "FAIL: Unhealthy services found" || echo "PASS: All services healthy"

# Test 2: Database Connectivity
docker compose exec postgres psql -U $POSTGRES_USER -d $POSTGRES_DB -c "SELECT version();" > /dev/null && echo "PASS: DB accessible" || echo "FAIL: DB connection failed"

# Test 3: Backup Functionality
docker compose exec backup bash -c "pg_dump -h postgres -U \$POSTGRES_USER \$POSTGRES_DB | head -5" | grep -q "PostgreSQL" && echo "PASS: Backup working" || echo "FAIL: Backup broken"

# Test 4: Monitoring Stack
curl -s http://localhost:9090/-/healthy | grep -q "Prometheus is Healthy" && curl -s http://localhost:3000/api/health | grep -q "ok" && echo "PASS: Monitoring healthy" || echo "FAIL: Monitoring issues"

# Test 5: Ollama Integration
curl -s http://host.docker.internal:11434/api/tags | grep -q "models" && echo "PASS: Ollama reachable" || echo "FAIL: Ollama unreachable"
```

#### Service-Specific Tests
```bash
# Test 6: Mailer Service Logs
docker compose logs praxis-mailer --tail 10 | grep -q "Service running" && echo "PASS: Praxis mailer active" || echo "FAIL: Praxis mailer silent"

# Test 7: Email Test (Mailpit)
curl -s http://localhost:8025/api/v1/messages | jq -r '.total' | grep -E '^[0-9]+$' && echo "PASS: Mailpit API working" || echo "FAIL: Mailpit API broken"

# Test 8: Volume Persistence
docker compose down && docker compose up -d postgres && sleep 10 && docker compose exec postgres psql -U $POSTGRES_USER -c "\l" | grep -q $POSTGRES_DB && echo "PASS: Data persisted" || echo "FAIL: Data lost"

# Test 9: Resource Limits
docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}" | awk 'NR>1 {gsub(/%/, "", $2); if($2 > 80) print "FAIL: " $1 " CPU high: " $2 "%"; else print "PASS: " $1 " CPU ok"}' 

# Test 10: Log Rotation
find /var/lib/docker/volumes -name "*.log" -size +100M 2>/dev/null | wc -l | grep -q "^0$" && echo "PASS: No oversized logs" || echo "FAIL: Large log files detected"
```

### Ergänzungsempfehlungen für END-SPEC.md

#### Fehlende Sektionen
1. **Security-Sektion**: Explizite Security-Anforderungen und Threat-Model
2. **Performance-Baselines**: Messbare Performance-Erwartungen 
3. **Disaster-Recovery**: Backup-Restore-Procedures
4. **Operational-Runbooks**: Troubleshooting-Guides für häufige Probleme
5. **Environment-Variables**: Vollständige Liste aller benötigten ENV-Vars mit Defaults

#### Konkrete Korrekturen
- **Traefik entfernen**: Keine Reverse-Proxy-Anforderung laut Briefing
- **MinIO optional machen**: S3-Storage nur bei Bedarf
- **Network-Definitionen**: Explizite Docker-Networks für Segmentierung
- **Service-Dependencies**: Präzise `depends_on` mit `condition: service_healthy`
- **Volume-Ownership**: Explizite User/Group-Zuweisungen für persistente Daten

---

## ZWEITER SENIOR-REVIEW - Vollständige Nachlieferung

### 1. END-SPEC.md Struktur-Definition

#### Exakte Struktur für END-SPEC.md
```markdown
# END-SPEC.md Template Structure

## 1. Project Overview
- Zweck und Scope des Docker-Agents-Systems
- Hardware-Setup (Windows 11, WSL2, AMD RX 7800)
- Architektur-Diagramm

## 2. Service Definitions
### 2.1 Core Services
- postgres, redis, n8n (mit exakten Versionen)
### 2.2 Mailer Services  
- praxis-mailer, ecom-mailer (mit Anhang-Handling)
### 2.3 Monitoring Stack
- prometheus, grafana, loki, promtail, cadvisor, node-exporter
### 2.4 Support Services
- mailpit, backup, minio (optional)

## 3. Security Model
- Docker Secrets Implementation
- Network Segmentation
- User/Group Mappings
- Virus Scanning Integration

## 4. Performance Specifications
- Ollama Tuning für AMD RX 7800
- Resource Limits pro Service
- SLA-Definitionen

## 5. Operational Requirements
- Backup/Restore Procedures
- Monitoring & Alerting
- Health Checks
- Log Management

## 6. Testing Framework
- Unit Tests pro Service
- End-to-End Mail Flow Tests
- Performance Benchmarks
- Disaster Recovery Tests
```

#### Messbare SLA-Ziele
```yaml
# SLA-Matrix für END-SPEC.md
Availability:
  Services: 99.5% uptime (max 3.6h downtime/month)
  Database: 99.9% uptime (max 43min downtime/month)
  Backup: 99% success rate (max 3 failures/100 runs)

Performance:
  Email_Processing: 
    - Without_AI: <5s per email
    - With_AI: <30s per email
    - Queue_Depth: <100 pending emails
  Database:
    - Query_Response: <100ms for standard queries
    - Connection_Pool: <50 concurrent connections
  Dashboard:
    - Load_Time: <3s for standard dashboards
    - Data_Freshness: <30s lag for real-time metrics

Recovery:
  Service_Restart: <5min to healthy state
  Full_System: <15min from cold start
  Data_Recovery: <30min from backup
```

### 2. Anhänge-Handling Konzept

#### Lokale Speicherung + Optional MinIO
```yaml
# Anhang-Storage-Architecture
attachment_storage:
  primary: 
    type: local_filesystem
    path: /app/data/attachments
    structure: /{year}/{month}/{message_id}/
    max_file_size: 50MB
    allowed_types: ['.pdf', '.png', '.jpg', '.docx', '.xlsx']
    
  secondary:
    type: minio_s3
    bucket: email-attachments
    retention: 90d
    encryption: AES256
    
virus_scanning:
  engine: clamav
  integration: sidecar_container
  scan_timeout: 30s
  quarantine_path: /app/data/quarantine
  
cleanup_policy:
  local_retention: 30d
  archive_to_s3: true
  cleanup_schedule: "0 2 * * *"  # Daily at 2 AM
```

#### Virenscan-Integration
```yaml
# ClamAV Sidecar Configuration
clamav:
  image: clamav/clamav:latest
  environment:
    - CLAMAV_NO_FRESHCLAMD=false
    - CLAMAV_NO_CLAMD=false
  volumes:
    - clamav_db:/var/lib/clamav
    - attachments_scan:/scan
  healthcheck:
    test: ["CMD", "clamdscan", "--version"]
    interval: 60s
    
# Mailer Service Integration
scan_workflow:
  1. Save attachment to temp directory
  2. Scan with clamav via TCP socket
  3. If clean: move to permanent storage
  4. If infected: move to quarantine + alert
  5. Update database with scan results
```

### 3. Monitoring & Retention Details

#### Konkrete Retention-Policies
```yaml
# Prometheus Configuration
prometheus:
  retention_time: 30d
  retention_size: 10GB
  scrape_interval: 15s
  evaluation_interval: 15s
  
  storage_config:
    - retention.time=30d
    - storage.tsdb.retention.size=10GB
    - storage.tsdb.wal-compression

# Loki Configuration  
loki:
  retention_period: 720h  # 30 days
  chunk_target_size: 1572864  # 1.5MB
  max_chunk_age: 2h
  
  table_manager:
    retention_deletes_enabled: true
    retention_period: 720h
    
  limits_config:
    max_query_length: 720h
    max_streams_per_user: 0
    max_entries_limit_per_query: 5000

# Log Rotation
log_rotation:
  docker_logs:
    max_size: 50m
    max_file: 3
  application_logs:
    max_size: 100m
    rotate_daily: true
    compress: true
    keep_days: 7
```

#### Standard-Grafana-Dashboards
```json
# Dashboard Specifications
mailer_dashboard:
  panels:
    - email_processing_rate (emails/hour)
    - email_queue_depth (pending count)
    - ai_processing_time (avg, p95, p99)
    - attachment_virus_scan_results
    - imap_connection_status
    - smtp_send_success_rate
    
database_dashboard:
  panels:
    - connection_pool_usage
    - query_performance (slow queries >100ms)
    - database_size_growth
    - backup_success_rate
    - replication_lag (if applicable)
    
system_dashboard:
  panels:
    - container_cpu_usage
    - container_memory_usage  
    - disk_usage_per_volume
    - ollama_gpu_utilization
    - network_io_per_service
```

### 4. Security Implementation Details

#### Gmail App-Passwort Handling mit Docker Secrets
```yaml
# Docker Secrets Definition
secrets:
  gmail_app_password:
    external: true
    name: gmail_app_password_v1
  postgres_password:
    external: true  
    name: postgres_password_v1
  grafana_admin_password:
    external: true
    name: grafana_admin_password_v1

# Service Integration
praxis-mailer:
  secrets:
    - source: gmail_app_password
      target: /run/secrets/smtp_pass
      mode: 0400
  environment:
    - SMTP_PASS_FILE=/run/secrets/smtp_pass
```

#### Secret-Management Best Practices
```bash
# Secret Creation Commands
echo "your_gmail_app_password" | docker secret create gmail_app_password_v1 -
echo "$(openssl rand -base64 32)" | docker secret create postgres_password_v1 -
echo "$(openssl rand -base64 24)" | docker secret create grafana_admin_password_v1 -

# Secret Rotation Strategy
rotation_schedule:
  gmail_app_password: manual (on security breach)
  postgres_password: quarterly  
  grafana_admin_password: monthly
  
# ENV-Variable Security Rules
environment_security:
  - NO plain-text passwords in compose.yml
  - Use _FILE suffix for secret file paths
  - Validate secrets on container startup
  - Log secret loading (without values)
  - Fail fast if secrets missing
```

### 5. Hardware-Tuning Spezifikationen

#### Ollama AMD RX 7800 Optimierung
```yaml
# Host Ollama Configuration (Windows)
ollama_config:
  gpu_layers: 35  # Optimal für RX 7800
  context_length: 4096
  num_thread: 8   # AMD Ryzen optimal
  batch_size: 512
  memory_limit: 8192  # 8GB für RX 7800
  
# Environment Variables für Container
ollama_integration:
  OLLAMA_HOST: "0.0.0.0:11434"
  OLLAMA_MODELS: "/usr/share/ollama/.ollama/models"
  OLLAMA_NUM_PARALLEL: 2
  OLLAMA_MAX_LOADED_MODELS: 1
  OLLAMA_FLASH_ATTENTION: false
  OLLAMA_GPU_MEMORY_FRACTION: 0.8
```

#### Container-Ressourcengrenzen
```yaml
# Node.js Mailer Services
mailer_resources:
  limits:
    memory: 512M
    cpus: '0.5'
  reservations:
    memory: 256M  
    cpus: '0.25'
  environment:
    - NODE_OPTIONS=--max-old-space-size=384
    - UV_THREADPOOL_SIZE=8

# Database Resources
postgres_resources:
  limits:
    memory: 2G
    cpus: '1.0'
  reservations:
    memory: 1G
    cpus: '0.5'
  environment:
    - shared_buffers=256MB
    - effective_cache_size=1536MB
    - max_connections=100

# Monitoring Stack
monitoring_resources:
  prometheus:
    limits: {memory: 1G, cpus: '0.5'}
    reservations: {memory: 512M, cpus: '0.25'}
  grafana:
    limits: {memory: 512M, cpus: '0.3'}  
    reservations: {memory: 256M, cpus: '0.15'}
  loki:
    limits: {memory: 1G, cpus: '0.5'}
    reservations: {memory: 512M, cpus: '0.25'}
```

### 6. End-to-End Funktionale Tests

#### Mail-Flow End-to-End Tests
```bash
# E2E Test 1: Vollständiger Mail-Workflow (praxis-mailer)
test_praxis_mail_flow() {
  # 1. Send test email via mailpit
  MAIL_ID=$(curl -s -X POST http://localhost:8025/api/v1/send \
    -H "Content-Type: application/json" \
    -d '{"from":"test@example.com","to":"praxis@example.com","subject":"Test Patient Anfrage","body":"Test message"}' \
    | jq -r '.ID')
  
  # 2. Verify mail received by praxis-mailer
  sleep 5
  docker compose logs praxis-mailer --tail 20 | grep -q "Processing email: $MAIL_ID" && echo "PASS: Mail received" || echo "FAIL: Mail not processed"
  
  # 3. Check DB entry created
  DB_ENTRY=$(docker compose exec postgres psql -U $POSTGRES_USER -d praxis -t -c "SELECT count(*) FROM emails WHERE external_id='$MAIL_ID';")
  [ "$DB_ENTRY" -eq 1 ] && echo "PASS: DB entry created" || echo "FAIL: No DB entry"
  
  # 4. Verify Ollama was called for AI processing
  docker compose logs praxis-mailer --tail 50 | grep -q "Ollama response" && echo "PASS: AI processing done" || echo "FAIL: No AI processing"
  
  # 5. Check metrics updated in Prometheus
  METRICS=$(curl -s http://localhost:9090/api/v1/query?query=emails_processed_total | jq -r '.data.result[0].value[1]')
  [ "$METRICS" -gt 0 ] && echo "PASS: Metrics updated" || echo "FAIL: No metrics"
}

# E2E Test 2: Anhang-Verarbeitung mit Virenscan
test_attachment_processing() {
  # 1. Send email with PDF attachment
  MAIL_WITH_PDF=$(curl -s -X POST http://localhost:8025/api/v1/send \
    -F "from=test@example.com" \
    -F "to=ecom@example.com" \
    -F "subject=Order with Invoice" \
    -F "attachment=@/tmp/test-invoice.pdf")
  
  # 2. Verify attachment saved locally
  sleep 10
  find /var/lib/docker/volumes/ecom_data/_data/attachments -name "*.pdf" -mmin -1 | grep -q "test-invoice.pdf" && echo "PASS: Attachment saved" || echo "FAIL: Attachment missing"
  
  # 3. Check virus scan completed
  docker compose logs clamav --tail 10 | grep -q "FOUND\|OK" && echo "PASS: Virus scan done" || echo "FAIL: No virus scan"
  
  # 4. Verify scan results in DB
  SCAN_RESULT=$(docker compose exec postgres psql -U $POSTGRES_USER -d ecom -t -c "SELECT virus_scan_status FROM attachments ORDER BY created_at DESC LIMIT 1;")
  [ "$SCAN_RESULT" = "clean" ] && echo "PASS: Clean scan result" || echo "FAIL: Scan result issue"
}

# E2E Test 3: System Recovery Test
test_system_recovery() {
  # 1. Stop all services
  docker compose down
  
  # 2. Start only essential services
  docker compose up -d postgres redis
  sleep 30
  
  # 3. Verify data persistence
  docker compose exec postgres psql -U $POSTGRES_USER -c "\l" | grep -q "praxis\|ecom" && echo "PASS: Data persisted" || echo "FAIL: Data lost"
  
  # 4. Start all services
  docker compose up -d
  sleep 60
  
  # 5. Verify all healthy
  HEALTHY_COUNT=$(docker compose ps --format json | jq -r 'select(.State == "running" and .Health == "healthy") | .Name' | wc -l)
  [ "$HEALTHY_COUNT" -ge 10 ] && echo "PASS: System recovered" || echo "FAIL: Recovery incomplete"
}

# E2E Test 4: Performance Under Load
test_performance_load() {
  # 1. Generate 50 test emails rapidly
  for i in {1..50}; do
    curl -s -X POST http://localhost:8025/api/v1/send \
      -H "Content-Type: application/json" \
      -d "{\"from\":\"load-test-$i@example.com\",\"to\":\"praxis@example.com\",\"subject\":\"Load Test $i\",\"body\":\"Load test message $i\"}" &
  done
  wait
  
  # 2. Monitor processing time
  START_TIME=$(date +%s)
  while [ $(docker compose exec postgres psql -U $POSTGRES_USER -d praxis -t -c "SELECT count(*) FROM emails WHERE subject LIKE 'Load Test%';") -lt 50 ]; do
    sleep 1
    CURRENT_TIME=$(date +%s)
    if [ $((CURRENT_TIME - START_TIME)) -gt 300 ]; then
      echo "FAIL: Load test timeout (>5min)"
      return 1
    fi
  done
  
  TOTAL_TIME=$(($(date +%s) - START_TIME))
  [ "$TOTAL_TIME" -lt 150 ] && echo "PASS: Load test completed in ${TOTAL_TIME}s" || echo "FAIL: Load test too slow (${TOTAL_TIME}s)"
}

# E2E Test 5: Monitoring Integration
test_monitoring_integration() {
  # 1. Verify all exporters running
  for port in 9090 9100 9187; do
    curl -s http://localhost:$port/metrics > /dev/null && echo "PASS: Port $port responding" || echo "FAIL: Port $port down"
  done
  
  # 2. Check Grafana dashboards accessible
  curl -s http://admin:$GRAFANA_PASSWORD@localhost:3000/api/dashboards/home | jq -r '.dashboards[].title' | grep -q "Mailer\|Database" && echo "PASS: Dashboards loaded" || echo "FAIL: Dashboard issue"
  
  # 3. Verify log aggregation in Loki
  LOG_COUNT=$(curl -s "http://localhost:3100/loki/api/v1/query_range?query={job=\"docker\"}&start=$(date -d '1 hour ago' -Ins)&end=$(date -Ins)" | jq -r '.data.result | length')
  [ "$LOG_COUNT" -gt 0 ] && echo "PASS: Logs in Loki" || echo "FAIL: No logs aggregated"
}
```

### Prioritäten für Implementierung

#### Kritisch (Vor Produktivbetrieb)
1. Health Checks für alle Services
2. Docker Secrets für Credentials  
3. Resource Limits (Memory/CPU)
4. Backup-Error-Handling
5. **Anhang-Virenscan Integration**
6. **End-to-End Test Framework**

#### Hoch (Erste Woche)
1. Non-Root Container Users
2. Log Retention Policies
3. Monitoring Alerts
4. Performance Baselines
5. **Ollama Hardware-Tuning**
6. **Grafana Standard-Dashboards**

#### Medium (Erste Monat)
1. Network Segmentation
2. Advanced Security Hardening
3. Operational Runbooks
4. Disaster Recovery Testing
5. **MinIO S3-Integration**
6. **Secret Rotation Automation**