# Automotive Assembly Tool Monitoring: AI Vibration Anomaly Detection

[![Python](https://img.shields.io/badge/Python-3.11%2B-blue.svg)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110%2B-009688.svg)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-19%20%7C%20TypeScript-61DAFB.svg)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-6.0%2B-646CFF.svg)](https://vitejs.dev)
[![Docker](https://img.shields.io/badge/Docker-Compose%20Ready-2496ED.svg)](https://docker.com)
[![License](https://img.shields.io/badge/License-Proprietary-red.svg)]()

Industrial, hardware-agnostic edge monitoring platform for automotive powertrain assembly tools (e.g., multi-spindle angle nutrunners, torque spindles). The system captures high-frequency triaxial vibration telemetry (1,000 Hz), computes time-domain and spectral FFT features, infers anomaly probabilities via calibrated ML models, executes closed-loop safety decisions via a dual-layer state machine, and provides an enterprise white-theme B2B monitoring dashboard.

---

## Architecture Overview

```
 [Physical BLE Node]   or   [Vendor Cloud Run API]   or   [Virtual Rig]
           │                         │                          │
           └─────────────────────────┼──────────────────────────┘
                                     ▼
                        Ingestion Service & Watchdog
                                     │
                                     ▼
                   ┌─────────────────┴──────────────────┐
                   │  Shared Feature Extractor (< 50ms) │  (RMS, Peak, Kurtosis, FFT Spectrum)
                   └─────────────────┬──────────────────┘
                                     ▼
                   ┌─────────────────┴──────────────────┐
                   │  Anomaly Model (Isolation Forest)  │  (Calibrated [0..1] Score + Smoothing)
                   └─────────────────┬──────────────────┘
                                     ▼
                   ┌────────────────────────────────────┐
                   │     Dual-Layer Decision Engine     │
                   │  Layer 1: Fixed Hard Limits (RMS)  │  (Immediate Stop, Wins Always)
                   │  Layer 2: AI Anomaly State Machine │  (NORMAL -> REDUCED_SPEED -> STOPPED)
                   └─────────────────┬──────────────────┘
                                     │
                   ┌─────────────────┴──────────────────┐
                   │     SQLite / TimescaleDB Store     │  (features, decisions, scores, recordings)
                   └─────────────────┬──────────────────┘
                                     │
                      FastAPI REST API & WebSocket (/ws/live)
                                     │
                         React + TypeScript Dashboard
                                     │
                  Closed-Loop Actuation Feedback & Industrial Siren
```

---

## Core Capabilities

1. **Live Tool Health & Prognostics**:
   - **Unified Operational Ribbon**: Station status, commanded speed, measured RPM, BLE node connectivity, and real-time health prognostics index (`OPTIMAL_HEALTH`, `DEGRADED`).
   - **Industrial Siren Alert Synthesizer**: Web Audio API audio synthesizer with multiple sound profiles (*Factory Wail*, *Klaxon*, *Pulsed Alert*) and individual mute controls that sound when a safety trip or emergency stop occurs.
   - **Real-Time Visualizations**: Rolling 60s vibration chart (RMS and Peak), FFT frequency spectrum, calibrated Anomaly Score Gauge with configurable warning/critical trip thresholds.

2. **Dual-Layer Decision Engine**:
   - **Layer 1 (Fixed Hard Limits)**: Enforces safety limits on RMS (e.g., 1.25g) and peak vibration independently of ML predictions.
   - **Layer 2 (AI Anomaly Machine)**: Scores above Warn threshold for consecutive windows command `REDUCED_SPEED` (50% speed setpoint, Amber beacon); scores above Critical threshold trigger `STOPPED` (0 RPM lockout, Red beacon).
   - **Mandatory Explicit Reset**: Once locked out, safety interlocks require an authorized operator reset before the spindle can re-energize.

3. **Live Motor Drive & Hardware Telemetry Deck**:
   - **Visual Spindle Simulator**: Smooth 60fps mechanical rotation, brake clamp visualizer, and precision analog/digital tachometer dial.
   - **Authentic Sensor Telemetry**: Live sensor MAC, triaxial RMS, peak acceleration, CR2032 battery voltage, and spindle temperature directly from incoming hardware packets.
   - **Closed-Loop Pipeline**: Live interactive block diagram visualizing the end-to-end signal chain from sensor to deceleration actuation.

4. **Database Explorer & Gold-Standard Recordings**:
   - **Tabbed Table Explorer**:
     - *Vibration Features Table (`features`)*: Search, inspect, edit, and insert vibration records.
     - *Safety Decisions Table (`decisions`)*: Audit safety state transitions, reasons, and commanded speed overrides.
     - *AI Anomaly Scores (`anomaly_scores`)*: View raw and smoothed inference logs across shifts.
     - *Recorded Datasets (`recordings`)*: Capture, preview 25-window feature vectors, edit labels (`normal` / `disturbed`), and export JSON/CSV training sessions.

5. **Model Studio & Edge Tuning**:
   - Train unsupervised Isolation Forests or supervised Random Forests directly in the UI.
   - Full evaluation metrics: Confusion Matrix, ROC-AUC, Precision, Recall, and Score Distributions.
   - Dynamic threshold calibration and one-click rollback.

6. **BLE Gateway & Vendor Integration**:
   - Compatible with industrial BLE gateways (Cassia, Minew, Nordic, Teltonika, Generic REST).
   - Cloud Run and vendor API polling support with automated hardware ping diagnostics.

---

## Default Accounts & RBAC

| Role | Username | Password | Permissions |
| :--- | :--- | :--- | :--- |
| **Admin** | `admin` | `admin123` | Full access: system settings, hierarchy, thresholds, models, reset, DB maintenance |
| **Engineer** | `engineer` | `engineer123` | Train models, activate checkpoints, tune thresholds, station reset |
| **Operator** | `operator` | `operator123` | Live monitoring, explicit safety resets, emergency stop |
| **Viewer** | `viewer` | `viewer123` | Read-only live telemetry and historical logs |

---

## Getting Started

### Prerequisites

- **Python**: 3.11 or higher
- **Node.js**: 18 or higher (with npm)
- **Git**

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/Sesuraja/Automotive-Assembly-Tool-Monitoring.git
   cd Automotive-Assembly-Tool-Monitoring
   ```

2. **Configure environment variables**:
   ```bash
   cp .env.example .env
   ```
   *(Optional)* Add your Google Gemini API key to `.env` to enable AI-assisted root-cause trip analyses.

3. **Install Python backend dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

4. **Install frontend dependencies**:
   ```bash
   cd frontend
   npm install
   cd ..
   ```

---

## Running the Platform

### Option 1: Unified Server Runner (Recommended)

Run the root server script which initializes the SQLite database, seeds baseline models and topology, and serves the application:

```bash
python run_server.py
```

- **Frontend Application**: [http://localhost:5173](http://localhost:5173) (or [http://localhost:8000](http://localhost:8000))
- **Interactive Swagger Docs**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **Live WebSocket Endpoint**: `ws://localhost:8000/ws/live`

### Option 2: Docker Compose

For containerized deployment with Nginx:

```bash
docker compose up --build
```

- **Frontend Application**: [http://localhost:3000](http://localhost:3000)
- **Backend API**: [http://localhost:8000](http://localhost:8000)

---

## Verification & Testing

Run unit and integration tests covering feature extraction, dual-layer decision engine persistence, explicit reset logic, and simulator cycles:

```bash
# Backend pytest suite
pytest -v

# Frontend TypeScript compilation
cd frontend
npm run build
```

---

## Project Structure

```
├── backend/
│   ├── app/
│   │   ├── api/            # FastAPI routes (live, recordings, gateway, models, admin)
│   │   ├── core/           # Feature extractor, Isolation Forest ML model, decision engine
│   │   ├── models/         # SQLAlchemy database models (schema.py)
│   │   ├── services/       # Ingestion service, model training, DB maintenance
│   │   ├── config.py       # Pydantic settings & environment configuration
│   │   ├── database.py     # SQLite/PostgreSQL session management
│   │   └── main.py         # FastAPI application entrypoint
│   └── artifacts/          # Pre-trained models (.joblib) & dataset recordings (.json)
├── frontend/
│   ├── src/
│   │   ├── components/     # LiveView, SimulatorDeck, RecordingsView, Settings, Header
│   │   ├── context/        # AppSettingsContext for station configuration
│   │   ├── services/       # REST API client & WebSocket streaming service
│   │   └── types/          # TypeScript contracts and telemetry definitions
│   └── vite.config.ts      # Vite bundler configuration
├── simulator/              # Virtual hardware motor rig & vibration exciter
├── run_server.py           # Unified local runner
├── requirements.txt        # Python package dependencies
├── docker-compose.yml      # Multi-container deployment configuration
└── README.md
```
