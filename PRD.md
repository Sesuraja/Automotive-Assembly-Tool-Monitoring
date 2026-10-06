# Product Requirements Document

## Automotive Assembly Tool Monitoring: AI Vibration Anomaly Detection

**Version:** 1.0 | **Stack:** Python, FastAPI, Docker, PostgreSQL/TimescaleDB, React | **Scope:** Demo station (anomaly detection, not validated remaining-life prediction)

---

## 1. Product Overview and Goals

An AI-based monitoring system that receives vibration data from an assembly-station motor rig, analyzes it, makes a safety/control decision (slow or stop), and shows everything live.

**Goals**

- Detect abnormal tool operation within 2 seconds of onset.
- Normal operation must not repeatedly trip the system (false trips under 1 per hour in a demo run).
- Fixed safety limits always work, independent of the AI model.
- Run end to end with no hardware, using a virtual simulator.

**Users:** Operator (watch, reset), Engineer (train models, tune thresholds), Admin (users, hierarchy, devices), Audience (live demo view).

**Out of scope:** remaining-useful-life prediction, certified functional safety.

---

## 2. System Architecture

```
[Real BLE node]  or  [Virtual Hardware Simulator]
        |  (same data contract)
        v
  Ingestion Service -> Feature Extractor -> Anomaly Model -> Decision Engine
        |                    |                  |               |
        +--------------------+------ Database (store everything)-+
                                   |
                         FastAPI Backend (REST + WebSocket)
                                   |
                           React Dashboard
                                   |
              Motor command back to rig / simulator (speed, stop, light)
```

- **Services (Docker Compose):** `api`, `ingestion`, `simulator`, `db`, `frontend`.
- **Key rule:** the ingestion layer is hardware-agnostic. The simulator and real BLE gateway publish the identical payload, so the rest of the system cannot tell them apart.

---

## 3. Receive Vibration Data

**Sources (selectable by config):** BLE gateway API (real) or Virtual Hardware Simulator.

**Payload contract (JSON):**

```json
{
  "device_id": "node-01",
  "station_id": "station-A",
  "ts": "2026-10-02T10:15:30.120Z",
  "seq": 10231,
  "sample_rate_hz": 1000,
  "window": [0.01, -0.02, 0.03],
  "axes": "xyz",
  "features": { "rms": 0.21, "peak": 0.9 },
  "motor": { "commanded_pct": 100, "measured_rpm": 2980 },
  "battery_pct": 87, "rssi": -58
}
```

**Requirements**

- Accept either raw sampled windows or on-device features.
- Detect gaps via `seq`, duplicate packets, out-of-order packets, and stale data (no packet in 1 s raises a "link lost" state).
- Reject malformed payloads with a logged error; never crash.
- Link lost during a run triggers a safe-state action (configurable: slow or stop).

---

## 4. Store Incoming Data

Every record is stored. Nothing is discarded.

| Table | Contents |
| --- | --- |
| `raw_windows` | device_id, ts, seq, sample array (compressed), sample rate |
| `features` | ts, rms, peak, crest factor, kurtosis, dominant freq, band energies |
| `anomaly_scores` | ts, model_version, score, state |
| `decisions` | ts, state, reason (model/limit/link), commanded speed |
| `motor_telemetry` | ts, commanded %, measured rpm, current if available |
| `events` | disturbance on/off, trip, reset, operator, notes |
| `recordings` | labelled sessions (normal / disturbed) for training |
| `models` | version, metrics, thresholds, artifact path, active flag |
| `users`, `roles`, `orgs`, `stations`, `devices` | hierarchy and RBAC |
| `audit_log` | who did what, when |

**Requirements:** TimescaleDB hypertables (or partitioned PostgreSQL) for time-series; batch inserts; retention policy (raw 30 days, features and decisions 1 year, configurable); CSV/Parquet export; Alembic migrations.

---

## 5. Extract Vibration Features

Computed per window (default 1 s window, 50% overlap).

- **Time domain:** RMS, peak, peak-to-peak, crest factor, kurtosis, skewness.
- **Frequency domain:** FFT dominant frequency, spectral centroid, energy in configurable bands (including the exciter frequency band).
- **Per axis and combined magnitude.**
- Skip extraction when the node already supplies features, but still validate them.
- Feature code is shared by training and live inference, so training and runtime can never drift apart.
- Latency budget: under 50 ms per window.

---

## 6. Train the Anomaly Model

**Data:** separate labelled recordings, one normal and one disturbed (exciter on), captured through the simulator or the real rig.

**Approach**

- Baseline: Isolation Forest or One-Class SVM trained on normal features, plus a supervised classifier (Random Forest or logistic regression) using normal vs disturbed recordings.
- Output: classification plus an **anomaly score from 0 to 1**.
- Score smoothing (moving average) to avoid single-window spikes.
- Train/validation split by recording, not by window, to avoid leakage.

**Workflow (UI and API):** upload or select recordings, label, train, view metrics (confusion matrix, ROC, score histogram), set the threshold, activate the model version, roll back.

**Rules:** versioned artifacts (joblib/ONNX); metrics stored with each version; wording in the UI is "anomaly detection", never "remaining life".

---

## 7. Decision Engine

Two independent layers. The hard limits layer always wins.

| Layer | Logic |
| --- | --- |
| **Fixed limits (no AI)** | RMS above limit, peak above limit, speed deviation, or link lost leads to immediate stop |
| **AI layer** | Score above warn threshold for N seconds leads to speed reduction; above critical threshold for N seconds leads to stop |

**State machine:** `NORMAL -> WARNING -> REDUCED_SPEED -> STOPPED -> (explicit reset) -> NORMAL`

- **Persistence:** actions only after the anomaly persists (e.g., 3 consecutive windows) to prevent nuisance trips.
- **Hysteresis:** different enter/exit thresholds.
- **Explicit reset:** after the disturbance is removed, the state stays STOPPED until an authorized user presses Reset. No auto-restart.
- **Outputs:** commanded speed %, indicator light (green/amber/red), event log entry with reason.
- Every decision records which layer caused it.

---

## 8. Virtual Hardware Simulator (Python)

Lets the full stack be tested and demonstrated with no physical rig.

**Components**

- **Virtual motor:** first-order speed response to command, speed feedback with noise, stall behavior.
- **Virtual vibration node:** generates accelerometer signal at the configured sample rate: base motor harmonics (speed-dependent) plus Gaussian noise.
- **Virtual exciter (disturbance):** adds a repeatable sinusoid and harmonics at a set frequency and amplitude.
- **Virtual indicator light and virtual BLE gateway:** sends the same payload as section 3 over HTTP/WebSocket/MQTT (selectable).

**Control (simulator API and dashboard panel)**

- Start/stop run, set scenario: `normal`, `disturbance_on`, `disturbance_ramp`, `sensor_dropout`, `packet_loss`, `noisy_normal`.
- Adjust amplitude and frequency of disturbance.
- Reacts to commands from the Decision Engine: reduced command lowers virtual rpm and vibration, stop brings it to zero.
- Fixed random seed option for repeatable tests.
- Recording mode: save labelled normal/disturbed sessions directly for training.

**Acceptance:** run a scripted scenario (normal 60 s, disturbance 30 s, remove, reset) and see the full state-machine cycle in the dashboard and database.

---

## 9. Backend and API Design

**FastAPI** with async handlers, Pydantic schemas, OpenAPI docs at `/docs`.

| Area | Endpoints |
| --- | --- |
| Ingest | `POST /api/v1/ingest`, `WS /ws/ingest` |
| Live | `WS /ws/live` (features, score, state, speeds, 10 to 20 Hz) |
| Status | `GET /api/v1/stations`, `GET /api/v1/stations/{id}/status` |
| History | `GET /api/v1/features`, `/scores`, `/decisions`, `/events` (time range, paging) |
| Control | `POST /api/v1/stations/{id}/reset`, `/stop`, `/mode` |
| Model | `POST /api/v1/models/train`, `GET /models`, `POST /models/{id}/activate` |
| Recordings | `POST /recordings/start`, `/stop`, `GET /recordings` |
| Simulator | `POST /api/v1/sim/scenario`, `GET /sim/state` |
| Admin | `/users`, `/roles`, `/orgs`, `/devices`, `/audit` |
| Health | `GET /health`, `/metrics` |

**Requirements:** JWT auth, versioned API, consistent error format, rate limiting on ingest, background workers for training, structured logging, pytest coverage above 80% on the decision engine.

---

## 10. Dashboard and Frontend

Professional **white-theme B2B UI** (clean, enterprise look, restrained palette, subtle motion; avoid generic "AI-generated" styling).

**Live view (audience-facing)**

- Station header with state badge (Normal / Warning / Reduced / Stopped) and indicator light.
- Live vibration charts (RMS, peak, spectrum) with rolling 60 s window.
- Anomaly score gauge with warn/critical threshold lines.
- Commanded speed vs measured speed, plotted together.
- Event timeline (disturbance on, reduction, stop, reset).
- Smooth animated transitions on state change; machine, disturbance and response are visible together.

**Other screens:** History and replay, Model management and training, Recordings, Simulator control panel, Devices and stations, Users and roles, Audit log, Settings (thresholds, retention).

**Tech:** React + TypeScript, Tailwind, Recharts or ECharts, WebSocket client with auto-reconnect, responsive, keyboard accessible, large-screen demo mode.

---

## 11. Security, Roles and Organization Hierarchy

- **Hierarchy:** Company > Plant > Line > Station > Device.
- **Roles:** Admin, Engineer, Operator, Viewer.

| Action | Viewer | Operator | Engineer | Admin |
| --- | --- | --- | --- | --- |
| View live and history | Yes | Yes | Yes | Yes |
| Reset after stop | No | Yes | Yes | Yes |
| Train / activate model | No | No | Yes | Yes |
| Change thresholds | No | No | Yes | Yes |
| Manage users/devices | No | No | No | Yes |

- Hashed passwords, JWT with refresh, device API keys for ingest, HTTPS in deployment, audit log of all control actions.

---

## 12. Non-Functional Requirements, Testing and Roadmap

**Non-functional**

- End-to-end latency (sample to dashboard) under 500 ms; anomaly to command under 2 s.
- Sustains 1 kHz sampling from 1 to 5 nodes.
- `docker compose up` brings the full stack, including simulator, with seed data.
- Safe failure: if the model, database, or link fails, fixed limits still protect.

**Testing and verification**

1. Unit tests: features, decision state machine, thresholds.
2. Simulator scenario tests (automated): normal does not trip; disturbance trips; removal alone does not restart; reset restarts.
3. False-trip soak: 1-hour normal run with zero unintended trips.
4. Replay tests from stored recordings.
5. Hardware-in-the-loop on the real rig using the same checklist.

**Roadmap**

| Phase | Deliverable |
| --- | --- |
| 1 | Data contract, ingestion, database, simulator |
| 2 | Feature extraction, decision engine with fixed limits |
| 3 | Model training and scoring, AI layer |
| 4 | Dashboard, RBAC, history |
| 5 | Polish UI, animation, soak tests, real BLE integration |

**Success criteria:** full demo cycle (normal, disturbance, slowdown/stop, removal, explicit reset) runs repeatably on the simulator and on the real rig, with every datapoint stored.