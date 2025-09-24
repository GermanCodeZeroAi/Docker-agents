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

### Prioritäten für Implementierung

#### Kritisch (Vor Produktivbetrieb)
1. Health Checks für alle Services
2. Docker Secrets für Credentials  
3. Resource Limits (Memory/CPU)
4. Backup-Error-Handling

#### Hoch (Erste Woche)
1. Non-Root Container Users
2. Log Retention Policies
3. Monitoring Alerts
4. Performance Baselines

#### Medium (Erste Monat)
1. Network Segmentation
2. Advanced Security Hardening
3. Operational Runbooks
4. Disaster Recovery Testing