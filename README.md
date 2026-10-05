# Automotive Assembly Tool Monitoring: AI Vibration Anomaly Detection

[![Python](https://img.shields.io/badge/Python-3.11%2B-blue.svg)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110%2B-009688.svg)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-19%20%7C%20TypeScript-61DAFB.svg)](https://react.dev)
[![Docker](https://img.shields.io/badge/Docker-Compose%20Ready-2496ED.svg)](https://docker.com)
[![License](https://img.shields.io/badge/License-Proprietary-red.svg)]()

Industrial, hardware-agnostic edge monitoring system for automotive powertrain assembly tools (e.g. multi-spindle angle nutrunners). The platform acquires high-frequency triaxial vibration telemetry (1000 Hz), computes physical spectral and statistical features, infers anomaly probability via calibrated ML models, executes safety-critical control decisions via a dual-layer state machine, and provides an enterprise white-theme B2B monitoring dashboard.

---

## Architecture Overview

```
 [Physical BLE Node]   or   [Virtual Hardware Simulator]
           │                         │
           └────────────┬────────────┘  (Identical Hardware-Agnostic JSON Payload)
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
      │ TimescaleDB / Partitioned SQLite   │  (raw_windows, features, scores, decisions)
      └─────────────────┬──────────────────┘
                        │
         FastAPI REST API & WebSocket (/ws/live)
                        │
            React + TypeScript Dashboard
                        │
     Motor Command Feedback Loop (Commanded Speed %, Beacon Light)
```

---

## Key Features

1. **Hardware-Agnostic Ingestion Contract**:
   - Ingestion layer accepts standard JSON packets from real BLE gateways or the Virtual Hardware Simulator.
   - Detects sequence gaps (`seq`), out-of-order/duplicate packets, and link silence (`> 1.0s` triggers link lost safe-stop).
2. **Dual-Layer Decision Engine**:
   - **Fixed Hard Limits Layer**: Evaluates RMS limit (1.25g), Peak limit (3.20g), and speed deviation without any AI dependency.
   - **AI Anomaly Layer**: Anomaly score above Warn threshold (`0.45`) for $N$ consecutive windows triggers `REDUCED_SPEED` (50% speed, Amber light); score above Critical threshold (`0.70`) triggers `STOPPED` (0% speed, Red light).
   - **Mandatory Explicit Reset**: Once tripped into `STOPPED`, the system locks out restart until an authorized Operator or Engineer executes an explicit reset.
3. **Virtual Hardware Simulator**:
   - Models first-order motor dynamics ($\tau = 0.3s$), measured tachometer feedback with sensor noise, baseline motor harmonics, and exciter resonance at 180 Hz.
   - Interactive Scenarios: `normal`, `disturbance_on`, `disturbance_ramp`, `sensor_dropout`, `packet_loss`, `noisy_normal`.
4. **Model Studio**:
   - Train unsupervised Isolation Forests or supervised Random Forests.
   - Full evaluation suite: Confusion Matrix (TN, FP, FN, TP), ROC-AUC, Precision, Recall, and Score Distribution Histogram.
   - Hot activation, threshold tuning, and instant rollback.
5. **Modern B2B White-Theme UI**:
   - Real-time rolling vibration charts (RMS & Peak 60s), FFT frequency spectrum, circular anomaly gauge, commanded vs measured RPM plot, and 3-stack physical beacon tower.

---

## Default Accounts & RBAC Matrix

| Role | Username | Password | Permissions |
| :--- | :--- | :--- | :--- |
| **Admin** | `admin` | `admin123` | Full access: users, devices, hierarchy, thresholds, models, reset |
| **Engineer** | `engineer` | `engineer123` | Train models, activate versions, tune thresholds, reset |
| **Operator** | `operator` | `operator123` | View live monitoring, execute explicit resets, emergency stop |
| **Viewer** | `viewer` | `viewer123` | Read-only live telemetry and historical logs |

---

## Quick Start Guide

### Option 1: Instant Local Launch (Recommended)

Run the automated orchestrator which initializes SQLite, seeds initial plant topology and baseline models, and opens the application in your browser:

```bash
# Windows
run_demo.bat

# Or via Python
python run_demo.py
```

- **Dashboard**: [http://localhost:8000](http://localhost:8000)
- **Interactive OpenAPI Documentation**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **Live Stream WebSocket**: `ws://localhost:8000/ws/live`

### Option 2: Docker Compose (Full Stack with PostgreSQL)

```bash
docker compose up --build
```

- **Frontend Application**: [http://localhost:3000](http://localhost:3000)
- **API Backend**: [http://localhost:8000](http://localhost:8000)
- **PostgreSQL / TimescaleDB**: `localhost:5432`

---

## Automated Test Suite

Run unit and integration tests covering feature extraction latency, dual-layer decision engine persistence, explicit reset enforcement, and full simulator scenario cycles:

```bash
pytest -v
```

---

## Step-by-Step Demonstration Walkthrough

1. **Launch the Dashboard**:
   Open [http://localhost:8000](http://localhost:8000). The station header displays `NORMAL` with a luminous `GREEN` beacon light.
2. **Observe Baseline Operation**:
   On the **Live Monitoring** tab, vibration RMS is nominal (~0.13g), tachometer sits at 3000 RPM, and the Anomaly Index is nominal (~0.15).
3. **Inject Resonance Fault**:
   Click on the **Hardware Simulator Deck** tab and select **Resonance Disturbance ON** (or move the Exciter Amplitude slider to 1.10g).
4. **Watch State Machine Transition**:
   Switch back to the **Live Monitoring** tab:
   - Within 1–2 seconds, the 180 Hz frequency spike lights up the FFT Spectrum.
   - The Anomaly Index swings into the warning zone &rarr; state turns `REDUCED_SPEED` with `AMBER` beacon light and motor decelerates to 1500 RPM (50%).
   - As persistence continues &rarr; state trips to `STOPPED` with `RED` flashing beacon light, commanding 0% speed (0 RPM).
5. **Verify No Auto-Restart**:
   In the Simulator Deck, switch back to **Steady Normal Baseline**. Note that even though vibration has returned to zero, the station remains safely locked in `STOPPED`.
6. **Execute Explicit Reset**:
   Click **Reset Tool** in the header. The station transitions back to `NORMAL`, 100% speed is commanded, and the beacon turns `GREEN`.
