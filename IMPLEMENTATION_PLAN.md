# IMPLEMENTATION_PLAN.md

## Docker-Agents: Lokale E-Mail-Automatisierung mit Monitoring

### **System-Kontext**
- **Host:** Windows 11, AMD RX 7800, Ollama nativ (DirectML/CPU)
- **Container-Runtime:** WSL2 Ubuntu 22.04, Docker + Compose v2
- **Ollama-Zugang:** `http://host.docker.internal:11434` (KEIN ROCm in Containern)
- **Netzwerk:** Alle Services über interne Docker-Netze, keine öffentlichen Ports
- **Persistenz:** Named Volumes für alle stateful Services
- **Monitoring:** Vollständige lokale Observability ohne externe Abhängigkeiten

---

## **Phase 1: Foundation Setup (Setup & Konfiguration)**

### **Task 1.1: Environment Template erstellen**
**Dauer:** 10 Minuten
**Betroffene Dateien:** `.env.example`, `compose.yml`
**Commit:** `feat: add environment configuration template`

**Beschreibung:**
- Erstelle `.env.example` mit allen erforderlichen Umgebungsvariablen
- Dokumentiere alle Services mit ihren Konfigurationsoptionen
- Stelle sicher, dass Ollama über host.docker.internal erreichbar ist

**Rollback-Strategie:**
- Lösche `.env.example` falls vorhanden
- Git revert commit

**Definition of Done:**
- Alle Services in compose.yml haben entsprechende ENV-Vars in .env.example
- Kommentare erklären jeden Parameter und seinen Zweck
- Ollama_BASE_URL ist auf host.docker.internal:11434 gesetzt

---

### **Task 1.2: Compose-Optimierung für Windows/WSL2**
**Dauer:** 15 Minuten
**Betroffene Dateien:** `compose.yml`
**Commit:** `fix: optimize docker compose for WSL2 environment`

**Beschreibung:**
- Entferne Traefik (nicht benötigt für lokale Entwicklung)
- Passe Volume-Mounts für WSL2-Kompatibilität an
- Stelle sicher, dass alle Ports nur intern gebunden sind
- Optimiere Resource-Limits für lokale Entwicklung

**Rollback-Strategie:**
- Git revert zu vorheriger compose.yml Version
- Docker compose down um Änderungen rückgängig zu machen

**Definition of Done:**
- Keine expose-Anweisungen für externe Netze
- Alle Volumes verwenden benannte Volumes statt Host-Pfade
- Resource-Limits sind für lokale Entwicklung optimiert

---

### **Task 1.3: Monitoring-Konfiguration erstellen**
**Dauer:** 10 Minuten
**Betroffene Dateien:** `monitoring/prometheus.yml`, `monitoring/promtail-config.yml`
**Commit:** `feat: add local monitoring configuration`

**Beschreibung:**
- Erstelle monitoring-Verzeichnis mit Prometheus-Konfiguration
- Konfiguriere Prometheus für lokale Service-Metriken
- Erstelle Promtail-Konfiguration für Log-Sammlung
- Stelle sicher, dass alle lokalen Services gemonitored werden

**Rollback-Strategie:**
- Lösche monitoring-Verzeichnis komplett
- Entferne Volume-Mounts in compose.yml

**Definition of Done:**
- monitoring/prometheus.yml scrapt alle Services korrekt
- promtail-config.yml sammelt Logs von allen Containern
- Keine externen Endpoints konfiguriert

---

## **Phase 2: Mailer-Service Implementation**

### **Task 2.1: E-Mail-Konfiguration und -Validierung**
**Dauer:** 10 Minuten
**Betroffene Dateien:** `mailer/ecom-mailer/index.js`, `mailer/praxis-mailer/index.js`
**Commit:** `feat: implement email connection validation`

**Beschreibung:**
- Implementiere robuste IMAP/SMTP-Verbindungstests
- Füge E-Mail-Template-Funktionalität hinzu
- Konfiguriere Anhänge-Handling (lokal/S3-kompatibel)
- Stelle sicher, dass Gmail App-Passwords korrekt verwendet werden

**Rollback-Strategie:**
- Git revert zu einfacher Connection-Test-Version
- Temporäres Abschalten der Mailer-Services

**Definition of Done:**
- Beide Mailer können erfolgreich Gmail-Konten authentifizieren
- E-Mail-Templates sind strukturiert und wiederverwendbar
- Anhänge werden korrekt behandelt

---

### **Task 2.2: Datenbank-Schema und -Integration**
**Dauer:** 15 Minuten
**Betroffene Dateien:** `scripts/init-db.sql`, `mailer/*/index.js`
**Commit:** `feat: implement database schema and integration`

**Beschreibung:**
- Erstelle Datenbank-Initialisierungsskript für beide Mailer
- Implementiere E-Mail-Tracking und -Status-Management
- Füge Queue-Mechanismus für ausstehende E-Mails hinzu
- Stelle sicher, dass beide Mailer separate Datenbanken verwenden

**Rollback-Strategie:**
- Datenbank-Container stoppen und Volumes löschen
- Git revert zu Connection-Test-only Version

**Definition of Done:**
- Datenbankschema unterstützt vollständige E-Mail-Workflows
- E-Mail-Status wird korrekt getrackt
- Queue-System ist implementiert und funktionsfähig

---

### **Task 2.3: Ollama-Integration für intelligente E-Mail-Verarbeitung**
**Dauer:** 10 Minuten
**Betroffene Dateien:** `mailer/*/index.js`, `common/ollama-client.js`
**Commit:** `feat: integrate Ollama for AI-powered email processing`

**Beschreibung:**
- Erstelle gemeinsamen Ollama-Client für beide Mailer
- Implementiere E-Mail-Klassifizierung und -Priorisierung
- Füge intelligente Antwort-Generierung hinzu
- Stelle sicher, dass KI-Modelle über host.docker.internal erreichbar sind

**Rollback-Strategie:**
- Fallback auf Template-basierte E-Mail-Generierung
- Deaktiviere KI-Funktionen temporär

**Definition of Done:**
- Ollama-Client funktioniert mit lokalen Modellen
- E-Mail-Inhalte werden intelligent klassifiziert
- KI-generierte Antworten sind verfügbar

---

## **Phase 3: Monitoring & Observability**

### **Task 3.1: Metriken und Dashboards konfigurieren**
**Dauer:** 15 Minuten
**Betroffene Dateien:** `monitoring/grafana-dashboards.json`, `monitoring/prometheus-rules.yml`
**Commit:** `feat: configure comprehensive monitoring dashboards`

**Beschreibung:**
- Erstelle vordefinierte Grafana-Dashboards für alle Services
- Konfiguriere Prometheus-Regeln für Alerting
- Implementiere Service-spezifische Metriken
- Stelle sicher, dass E-Mail-Services gemonitored werden

**Rollback-Strategie:**
- Verwende Standard-Grafana-Dashboards
- Deaktiviere benutzerdefinierte Prometheus-Regeln

**Definition of Done:**
- Dashboards zeigen alle wichtigen Metriken an
- Alerts sind für kritische Services konfiguriert
- E-Mail-Verarbeitungsstatistiken sind sichtbar

---

### **Task 3.2: Log-Aggregation und -Analyse**
**Dauer:** 10 Minuten
**Betroffene Dateien:** `monitoring/loki-config.yml`, `common/logger.js`
**Commit:** `feat: implement centralized logging system`

**Beschreibung:**
- Erweitere Promtail-Konfiguration für strukturierte Logs
- Implementiere gemeinsamen Logger für alle Services
- Konfiguriere Log-Retention und -Rotation
- Stelle sicher, dass E-Mail-Logs kategorisiert werden

**Rollback-Strategie:**
- Fallback auf Docker-Logs
- Deaktiviere Loki/Promtail temporär

**Definition of Done:**
- Alle Services loggen strukturiert in Loki
- E-Mail-spezifische Logs sind kategorisiert
- Log-Analyse ist über Grafana möglich

---

## **Phase 4: Backup & Recovery**

### **Task 4.1: Backup-Strategie implementieren**
**Dauer:** 10 Minuten
**Betroffene Dateien:** `scripts/backup.sh`, `scripts/restore.sh`, `compose.yml`
**Commit:** `feat: implement automated backup and recovery`

**Beschreibung:**
- Erstelle automatisierte Backup-Skripte für PostgreSQL
- Implementiere Restore-Mechanismus
- Konfiguriere tägliche Backups über Cron
- Stelle sicher, dass Backups außerhalb der Container gespeichert werden

**Rollback-Strategie:**
- Stoppe Backup-Container
- Verwende manuelle pg_dump/pg_restore

**Definition of Done:**
- Automatische tägliche Backups funktionieren
- Restore-Prozess ist getestet
- Backup-Dateien werden korrekt gespeichert

---

### **Task 4.2: Health-Checks und Recovery-Mechanismen**
**Dauer:** 10 Minuten
**Betroffene Dateien:** `scripts/healthcheck.sh`, `compose.yml`
**Commit:** `feat: implement comprehensive health checks`

**Beschreibung:**
- Erstelle Health-Check-Skripte für alle Services
- Implementiere automatische Service-Restarts bei Fehlern
- Konfiguriere Abhängigkeiten in compose.yml
- Stelle sicher, dass fehlschlagende Services korrekt behandelt werden

**Rollback-Strategie:**
- Entferne Health-Check-Konfigurationen
- Verwende Standard-Docker-Healthchecks

**Definition of Done:**
- Alle Services haben funktionierende Health-Checks
- Automatische Recovery-Mechanismen sind aktiv
- Abhängigkeiten sind korrekt konfiguriert

---

## **Phase 5: Testing & Documentation**

### **Task 5.1: Integration-Tests erstellen**
**Dauer:** 15 Minuten
**Betroffene Dateien:** `test/integration-test.sh`, `test/README.md`
**Commit:** `feat: add comprehensive integration tests`

**Beschreibung:**
- Erstelle End-to-End Integration-Tests
- Teste E-Mail-Workflows vollständig
- Validiere Monitoring und Logging
- Stelle sicher, dass alle Services korrekt interagieren

**Rollback-Strategie:**
- Deaktiviere Integration-Tests temporär
- Verwende manuelle Tests

**Definition of Done:**
- Integration-Tests decken alle Hauptfunktionen ab
- Tests können automatisch ausgeführt werden
- Test-Ergebnisse werden geloggt

---

### **Task 5.2: Operations-Dokumentation**
**Dauer:** 15 Minuten
**Betroffene Dateien:** `OPS-CHECKS.md`, `README.md`, `docs/`
**Commit:** `docs: create comprehensive operations guide`

**Beschreibung:**
- Erstelle detaillierte OPS-CHECKS.md mit allen Prüfpunkten
- Aktualisiere README.md mit Setup- und Betriebsanweisungen
- Dokumentiere Troubleshooting-Prozeduren
- Stelle sicher, dass alle Windows/WSL2-spezifischen Schritte dokumentiert sind

**Rollback-Strategie:**
- Verwende bestehende Dokumentation
- Entferne neue Dokumentationsdateien

**Definition of Done:**
- Vollständige Betriebsdokumentation ist verfügbar
- Troubleshooting-Guide deckt häufige Probleme ab
- Windows/WSL2-Setup ist detailliert beschrieben

---

## **Phase 6: Final Assembly & Validation**

### **Task 6.1: Final System Integration**
**Dauer:** 10 Minuten
**Betroffene Dateien:** `compose.yml`, `.env.example`, `scripts/start.sh`
**Commit:** `feat: complete system integration`

**Beschreibung:**
- Erstelle einheitliches Start-Skript für das gesamte System
- Validiere alle Service-Abhängigkeiten
- Teste vollständigen System-Start und -Stop
- Stelle sicher, dass alle Volumes korrekt gemountet sind

**Rollback-Strategie:**
- Verwende docker compose direkt
- Temporäres Abschalten von Services mit Problemen

**Definition of Done:**
- System startet und stoppt vollständig automatisiert
- Alle Services sind korrekt verbunden
- Persistenz funktioniert über Neustarts hinweg

---

### **Task 6.2: Performance-Optimierung**
**Dauer:** 10 Minuten
**Betroffene Dateien:** `compose.yml`, `monitoring/`
**Commit:** `perf: optimize system performance`

**Beschreibung:**
- Optimiere Resource-Limits für lokale Entwicklung
- Konfiguriere effiziente Log- und Metrik-Sammlung
- Implementiere Caching wo sinnvoll
- Stelle sicher, dass System ressourcen-effizient läuft

**Rollback-Strategie:**
- Revert zu Standard-Resource-Limits
- Deaktiviere Performance-Optimierungen

**Definition of Done:**
- System läuft stabil mit moderaten Ressourcen
- Monitoring overhead ist minimal
- Performance-Metriken werden getrackt

---

## **Technische Constraints (KEIN ROCm)**

- **Ollama läuft ausschließlich auf Windows-Host** über `host.docker.internal:11434`
- **Keine GPU-Unterstützung in Containern** - AMD ROCm wird nicht verwendet
- **Alle KI-Verarbeitung erfolgt über HTTP-API-Calls** an den Host-Service
- **Container verwenden CPU-only** für alle Berechnungen
- **Network-Kommunikation** zwischen WSL2 und Windows-Host ist optimiert

---

## **Commit-Strategie**

Jeder Task endet mit einem **spezifischen Git-Commit** mit:
- **Deskriptiver Commit-Message** entsprechend Conventional Commits
- **Referenz zum Task** in der Commit-Message
- **Task-Nummer** als Footer

**Beispiel:**
```
feat: implement email connection validation

Task 2.1: E-Mail-Konfiguration und -Validierung
- Implementierte robuste IMAP/SMTP-Verbindungstests
- Fügte E-Mail-Template-Funktionalität hinzu
```

---

## **Validation-Kriterien**

Jeder Task ist erst abgeschlossen wenn:
- ✅ **Definition of Done** erfüllt ist
- ✅ **OPS-CHECKS.md** validiert werden kann
- ✅ **Keine Breaking Changes** für bestehende Funktionalität
- ✅ **Rollback-Strategie** ist getestet
- ✅ **Dokumentation** ist aktualisiert

---

## **Risiko-Management**

- **Hohe Tasks:** Backup-Strategie für jeden Task definiert
- **Abhängigkeiten:** Tasks sind so sequenziert, dass Abhängigkeiten berücksichtigt werden
- **Testing:** Jeder Task kann unabhängig validiert werden
- **Fallbacks:** Klare Fallback-Strategien für kritische Tasks