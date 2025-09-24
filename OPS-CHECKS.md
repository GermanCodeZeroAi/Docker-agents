## OPS-CHECKS: Lokales Automation/Mailer/Monitoring-Setup (WSL2, Docker Compose)

Ziel: Reproduzierbares Prüf-Playbook für Bring-up, Funktions-Checks, Persistenz, Restore-Probe und Minimal-Runbook. Alle Befehle aus WSL2 Bash, ohne Interaktion.

Voraussetzungen: Windows 11 Host mit Ollama nativ (DirectML/CPU), WSL2 Ubuntu 22.04, Docker Engine + Compose v2 in WSL2, Repository-Root als aktuelles Verzeichnis.

---

### 1) Preflight-Checks

- **WSL2-Umgebung verifizieren**

```bash
set -euo pipefail

echo "[WSL] Kernel:"; uname -r
echo "[WSL] Version-String:"; grep -i microsoft /proc/version || true
echo "[WSL] Interop verfügbar:"; test -f /proc/sys/fs/binfmt_misc/WSLInterop && echo OK || (echo NOK; exit 1)
```

- **Docker Engine + Compose v2 in WSL2**

```bash
docker version || { echo "Docker nicht verfügbar"; exit 1; }
docker compose version || { echo "Docker Compose v2 nicht verfügbar"; exit 1; }
echo "[Docker] Root Dir:"; docker info --format '{{ .DockerRootDir }}' || true
```

- **Secrets/ENV laden und prüfen (.env im Repo-Root)**

```bash
test -f .env || { echo ".env fehlt im Repo-Root"; exit 1; }
set -a; source .env; set +a

required_vars=(
  POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB
  GF_SECURITY_ADMIN_USER GF_SECURITY_ADMIN_PASSWORD
  MINIO_ROOT_USER MINIO_ROOT_PASSWORD
  SMTP_USER SMTP_PASS
  PRAXIS_DB_USER PRAXIS_DB_PASS
  ECOM_DB_USER ECOM_DB_PASS
)
missing=0; for v in "${required_vars[@]}"; do
  [ -n "${!v:-}" ] || { echo "ENV fehlt: $v"; missing=1; }
done; [ "$missing" -eq 0 ] || exit 1
```

- **Ressourcen-Check (RAM/Platte)**

```bash
echo "[RAM]"; free -h
echo "[Disk Root]"; df -h /
docker_root_dir=$(docker info --format '{{ .DockerRootDir }}' 2>/dev/null || true)
[ -n "$docker_root_dir" ] && { echo "[Disk Docker Root]"; df -h "$docker_root_dir"; } || true

# Soft-Minima (nicht hart erzwungen): >= 8 GiB RAM frei, >= 20 GiB Disk frei
```

- **Connectivity zu Ollama (Windows-Host) prüfen**

```bash
echo "[DNS] host.docker.internal:"; getent hosts host.docker.internal || { echo "DNS für host.docker.internal fehlt"; exit 1; }
code=$(curl -sS -o /dev/null -w '%{http_code}' http://host.docker.internal:11434/api/tags || true)
echo "[Ollama] HTTP $code"
[ "$code" = "200" ] || { echo "Ollama nicht erreichbar (erwarte 200)"; exit 1; }
```

- **Optional: Monitoring-Configs vorhanden?**

In `compose.yml` werden `./monitoring/prometheus.yml` und `./monitoring/promtail-config.yml` gemountet. Falls nicht vorhanden, vor dem Bring-up bereitstellen oder Services temporär auskommentieren.

```bash
test -f monitoring/prometheus.yml && echo OK || echo "Hinweis: monitoring/prometheus.yml fehlt"
test -f monitoring/promtail-config.yml && echo OK || echo "Hinweis: monitoring/promtail-config.yml fehlt"
```

---

### 2) Bring-up: Reihenfolge und Zeiten

Empfohlene Reihenfolge (ungefähre Warm-up/Health-Zeiten in Klammern):
- **postgres** (5–15s), **redis** (1–3s)
- **loki** (10–20s), **promtail** (0–5s), **node-exporter** (1–3s), **cadvisor** (3–8s), **postgres-exporter** (2–5s)
- **prometheus** (5–15s), **grafana** (10–25s)
- **mailpit** (1–3s), **minio** (5–10s)
- **n8n** (20–45s)
- **praxis-mailer**, **ecom-mailer** (sofort, aber prüfen Verbindungs-Tests)
- **backup** (erstellt umgehend ersten Dump, dann 24h Schlaf)

Ausführung:

```bash
set -euo pipefail

# 1) Compose validieren
docker compose -f compose.yml config >/dev/null

# 2) Images bauen/pullen (Mailer werden lokal gebaut)
docker compose -f compose.yml build --pull

# 3) Stack starten
docker compose -f compose.yml up -d

# 4) Kernendpunkte abwarten (einfache Polls)
wait_http() { url="$1"; name="$2"; timeout="${3:-60}"; for i in $(seq 1 "$timeout"); do code=$(curl -sS -o /dev/null -w '%{http_code}' "$url" || true); [ "$code" = "200" ] && { echo "[$name] OK"; return 0; }; sleep 1; done; echo "[$name] TIMEOUT"; return 1; }

wait_http http://localhost:9090/-/ready       prometheus 60 || true
wait_http http://localhost:3000/api/health    grafana    90 || true
wait_http http://localhost:8025               mailpit    30 || true
wait_http http://localhost:9001               minio-ui   60 || true
wait_http http://localhost:3100/ready         loki       60 || true
wait_http http://localhost:8081/metrics       cadvisor   30 || true
wait_http http://localhost:9100/metrics       node-exp   30 || true
wait_http http://localhost:9187/metrics       pg-exp     30 || true
# n8n hat keinen stabilen Health-Endpoint by default; HTTP 200 auf Root ist ausreichend
curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:5678 | grep -qE '^(200|302)$' && echo "[n8n] OK" || echo "[n8n] prüfen"
```

---

### 3) Prüfkommandos pro Service (mit Fehlerbildern & Sofortmaßnahmen)

- **postgres**
  - Check:
    ```bash
    docker compose exec -T postgres bash -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select 1"'
    ```
  - Fehlerbilder / Maßnahmen:
    - Connection refused: Ports/Service-Status prüfen, Logs ansehen: `docker compose logs --no-log-prefix postgres | tail -n 200`
    - Auth failed: `.env` für `POSTGRES_USER/PASSWORD` prüfen

- **redis**
  - Check:
    ```bash
    docker compose exec -T redis redis-cli PING | grep -q PONG && echo OK || echo NOK
    ```
  - Fehlerbilder / Maßnahmen: Container-Neustart, Port-Konflikte prüfen

- **n8n**
  - Check:
    ```bash
    curl -sS -I http://localhost:5678 | grep -E '^HTTP/' || true
    docker compose logs --no-log-prefix n8n | tail -n 200
    ```
  - Fehlerbilder / Maßnahmen: DB-Verbindung (`postgres`) und `redis` prüfen; `OLLAMA_BASE_URL` nur benötigt, falls Flows das nutzen

- **mailpit**
  - Check:
    ```bash
    curl -sS -I http://localhost:8025 | grep -E '^HTTP/' || true
    ```
  - Fehlerbilder / Maßnahmen: Port 8025 belegt? Container neu starten

- **minio**
  - Check:
    ```bash
    curl -sS -I http://localhost:9001 | grep -E '^HTTP/' || true
    curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:9000/minio/health/ready
    ```
  - Fehlerbilder / Maßnahmen: Credentials aus `.env` (`MINIO_ROOT_USER/_PASSWORD`) prüfen

- **prometheus**
  - Check:
    ```bash
    curl -sS http://localhost:9090/-/ready
    docker compose logs --no-log-prefix prometheus | tail -n 200
    ```
  - Fehlerbilder / Maßnahmen: `monitoring/prometheus.yml` Pfad/Config prüfen

- **grafana**
  - Check:
    ```bash
    curl -sS http://localhost:3000/api/health
    docker compose logs --no-log-prefix grafana | tail -n 200
    ```
  - Fehlerbilder / Maßnahmen: Admin-Creds (`GF_SECURITY_ADMIN_*`) prüfen; Volume `grafana-data` bereinigen bei korrupten States

- **loki**
  - Check:
    ```bash
    curl -sS http://localhost:3100/ready
    curl -sS "http://localhost:3100/loki/api/v1/labels" | grep -E 'status|data' || true
    ```
  - Fehlerbilder / Maßnahmen: Config-Defaults ok; Ports nicht belegt

- **promtail**
  - Check:
    ```bash
    docker compose logs --no-log-prefix promtail | tail -n 200
    # Optional: Query in Loki nach container_name Label (Beispiel):
    curl -sS --get "http://localhost:3100/loki/api/v1/query" --data-urlencode 'query={container="promtail"} |= "ready"' | grep -E 'status|data' || true
    ```
  - Fehlerbilder / Maßnahmen: `monitoring/promtail-config.yml` prüfen; Loki-URL stimmt? Dateimounts vorhanden?

- **cadvisor**
  - Check:
    ```bash
    curl -sS -I http://localhost:8081/ | grep -E '^HTTP/' || true
    ```
  - Fehlerbilder / Maßnahmen: Docker Socket/Volumes-Mounts existieren?

- **node-exporter**
  - Check:
    ```bash
    curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:9100/metrics
    ```
  - Fehlerbilder / Maßnahmen: Port-Konflikt prüfen

- **postgres-exporter**
  - Check:
    ```bash
    curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:9187/metrics
    ```
  - Fehlerbilder / Maßnahmen: `DATA_SOURCE_NAME` korrekt zusammengesetzt? DB up?

- **backup**
  - Check (Dump-Datei sollte kurz nach Start erscheinen):
    ```bash
    docker compose logs --no-log-prefix backup | tail -n 50 || true
    docker compose exec -T backup bash -lc 'ls -l /backups | tail -n +1'
    ```
  - Fehlerbilder / Maßnahmen: DB erreichbar? Volume `backups` gemountet?

- **praxis-mailer / ecom-mailer**
  - Check:
    ```bash
    docker compose logs --no-log-prefix praxis-mailer | tail -n 200
    docker compose logs --no-log-prefix ecom-mailer   | tail -n 200
    # Erwartet: "Testing connections..." und ✓ für IMAP/SMTP/PostgreSQL/Ollama
    ```
  - Fehlerbilder / Maßnahmen:
    - IMAP/SMTP fail: Gmail App-Passwort, `IMAP_HOST/PORT`, `SMTP_HOST/PORT`, `SMTP_USER/PASS` prüfen
    - PostgreSQL fail: `DB_URL` (praxis/ecom) stimmt? DB existiert?
    - Ollama fail: Erreichbarkeit Host: `curl http://host.docker.internal:11434/api/tags`

---

### 4) Persistenz-Tests

Ziel: DB-Einträge und Dateien über Container-Reboots hinweg nachweisen; Backups sichtbar.

```bash
set -euo pipefail

# 1) (Falls nötig) praxis/ecom Datenbanken anlegen
docker compose exec -T postgres bash -lc 'psql -U "$POSTGRES_USER" -d postgres -tc "SELECT 1 FROM pg_database WHERE datname = '\''praxis'\''" | grep -q 1 || createdb -U "$POSTGRES_USER" praxis'
docker compose exec -T postgres bash -lc 'psql -U "$POSTGRES_USER" -d postgres -tc "SELECT 1 FROM pg_database WHERE datname = '\''ecom'\''"   | grep -q 1 || createdb -U "$POSTGRES_USER" ecom'

# 2) Test-Tabelle + Eintrag in praxis/ecom
for db in praxis ecom; do
  docker compose exec -T postgres bash -lc 'psql -U "$POSTGRES_USER" -d '"$db"' -v ON_ERROR_STOP=1 -c "CREATE TABLE IF NOT EXISTS ops_check (id serial primary key, note text, created_at timestamptz default now());"'
  docker compose exec -T postgres bash -lc 'psql -U "$POSTGRES_USER" -d '"$db"' -v ON_ERROR_STOP=1 -c "INSERT INTO ops_check (note) VALUES ('\''persist-test'\'');"'
done

# 3) Dummy-Attachments in Mailer-Volumes
docker compose exec -T praxis-mailer bash -lc 'mkdir -p /app/data && head -c 1024 </dev/urandom > /app/data/ops-attachment-praxis.bin'
docker compose exec -T ecom-mailer   bash -lc 'mkdir -p /app/data && head -c 1024 </dev/urandom > /app/data/ops-attachment-ecom.bin'

# 4) Reboot aller Container
docker compose restart
sleep 10

# 5) Nachweise: DB + Dateien + Backup
for db in praxis ecom; do
  docker compose exec -T postgres bash -lc 'psql -U "$POSTGRES_USER" -d '"$db"' -c "SELECT id, note, created_at FROM ops_check ORDER BY id DESC LIMIT 1;"'
done
docker compose exec -T praxis-mailer bash -lc 'ls -l /app/data/ops-attachment-praxis.bin'
docker compose exec -T ecom-mailer   bash -lc 'ls -l /app/data/ops-attachment-ecom.bin'

# Backup-Datei vorhanden?
docker compose exec -T backup bash -lc 'ls -1t /backups/backup-*.sql | head -n1'
```

---

### 5) Restore-Probe (isoliert)

Ziel: Jüngsten Dump in einem isolierten, temporären Postgres-Container wiederherstellen.

```bash
set -euo pipefail

# 1) Jüngsten Dump ermitteln (Pfad im Backup-Container)
LATEST=$(docker compose exec -T backup bash -lc 'ls -1t /backups/backup-*.sql | head -n1' | tr -d '\r')
[ -n "$LATEST" ] || { echo "Kein Backup gefunden"; exit 1; }
echo "Verwende Dump: $LATEST"

# 2) Temporären Postgres starten (detach), Volume "backups" mounten
docker rm -f pg-restore-probe >/dev/null 2>&1 || true
docker run -d --name pg-restore-probe -e POSTGRES_PASSWORD=probe -e POSTGRES_DB=probe \
  -v backups:/backups postgres:16

# 3) Warten bis bereit
for i in $(seq 1 30); do docker exec pg-restore-probe pg_isready -U postgres && break; sleep 1; done

# 4) Ziel-DB erstellen und Dump einspielen
docker exec -e PGPASSWORD=probe pg-restore-probe psql -U postgres -d postgres -c 'CREATE DATABASE restoreprobe;' || true
docker exec -e PGPASSWORD=probe pg-restore-probe bash -lc 'psql -U postgres -d restoreprobe -f '"$LATEST"''

# 5) Verifizieren, dass SQL-Objekte existieren (z.B. Tabelle public.ops_check, falls im Dump)
docker exec -e PGPASSWORD=probe pg-restore-probe psql -U postgres -d restoreprobe -c "\dt" || true

# 6) Aufräumen
docker rm -f pg-restore-probe
```

---

### 6) Minimal-Runbook (Start/Stop/Update/Logs/Cleanup)

- **Start**
  ```bash
  docker compose -f compose.yml up -d
  ```

- **Stop (sanft)**
  ```bash
  docker compose -f compose.yml stop
  ```

- **Vollständiges Stoppen + Netzwerk entfernen**
  ```bash
  docker compose -f compose.yml down
  ```

- **Update (Images ziehen/bauen, Neustart)**
  ```bash
  docker compose -f compose.yml pull
  docker compose -f compose.yml build --pull
  docker compose -f compose.yml up -d --remove-orphans
  ```

- **Logs ansehen (Beispiele)**
  ```bash
  docker compose logs --no-log-prefix -f n8n
  docker compose logs --no-log-prefix --since=30m loki
  docker compose logs --no-log-prefix praxis-mailer | tail -n 200
  ```

- **Status/Health**
  ```bash
  docker compose ps
  docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
  ```

- **Cleanup (vorsichtig!)**
  ```bash
  # Stop + Volumes entfernen (löscht Persistenz!)
  docker compose down -v
  # Ungenutzte Objekte aufräumen
  docker system prune -f
  docker volume prune -f
  docker image prune -f
  ```

---

Hinweise:
- Traefik ist im Compose enthalten, aber kein externes Routing/ACME nötig; lokaler Zugriff reicht.
- Mailer-Services prüfen beim Start nur die Konnektivität (IMAP/SMTP/Postgres/Ollama) und loggen Heartbeats.
- Für S3-Tests kann optional `minio/mc` verwendet werden (nicht Teil dieses Playbooks).

