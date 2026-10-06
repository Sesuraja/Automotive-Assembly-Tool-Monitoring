export type StationState = 'NORMAL' | 'WARNING' | 'REDUCED_SPEED' | 'STOPPED';
export type IndicatorLightColor = 'GREEN' | 'AMBER' | 'RED';
export type UserRole = 'Admin' | 'Engineer' | 'Operator';

export interface BleGateway {
  id: string;
  name: string;
  mac_address: string;
  ip_address: string;
  status: 'online' | 'offline' | 'degraded';
  station_id: string;
  last_seen: string;
  packets_received: number;
  packets_dropped: number;
  avg_rssi: number;
  battery_pct: number;
  firmware_version: string;
  api_endpoint: string;
}

export interface BleGatewayDocs {
  endpoint: string;
  method: string;
  headers: Record<string, string>;
  sample_curl: string;
  sample_python: string;
}

export interface VendorGatewayConfig {
  id: string;
  name: string;
  vendor_type: string;
  api_url: string;
  api_key: string;
  poll_interval_sec: number;
  station_id: string;
  mac_filter: string;
  is_active: boolean;
  last_sync?: string | null;
  last_status: string;
  last_error?: string | null;
  packets_received: number;
  webhook_url: string;
}

export interface VendorSyncResult {
  status: 'success' | 'warning' | 'error';
  message: string;
  latency_ms: number;
  http_status?: number | null;
  samples_ingested?: number;
  actuation?: any;
  error_detail?: string;
}

export interface VendorTestEndpointResult {
  status: 'success' | 'warning' | 'error';
  message: string;
  http_status?: number | null;
  latency_ms: number;
  is_json?: boolean;
  detected_samples?: number;
  data_preview?: any;
  error_detail?: string;
}

export interface VibrationFeatures {
  rms: number;
  peak: number;
  peak_to_peak?: number;
  crest_factor?: number;
  kurtosis?: number;
  skewness?: number;
  dominant_freq?: number;
  spectral_centroid?: number;
  band_energies?: Record<string, number>;
}

export interface SpectrumBin {
  freq: number;
  magnitude: number;
}

export interface LiveTelemetry {
  device_id: string;
  station_id: string;
  ts: string;
  seq: number;
  state: StationState;
  indicator_light: IndicatorLightColor;
  commanded_speed_pct: number;
  measured_rpm: number;
  current_amps?: number;
  features: VibrationFeatures;
  raw_anomaly_score: number;
  smoothed_anomaly_score: number;
  warn_threshold: number;
  critical_threshold: number;
  last_decision_reason: string;
  layer_caused: string;
  battery_pct: number;
  rssi: number;
  temperature?: number;
  fft_spectrum?: SpectrumBin[];
  latest_trip_analysis?: MotorStopAnalysis | null;
  ai_health?: ToolHealthInfo | null;
  motor_nominal_rpm?: number;
  motor_max_rpm?: number;
}

export interface MotorStopAnalysis {
  id?: number;
  station_id: string;
  device_id?: string;
  timestamp: string;
  primary_cause: string;
  fault_category: string;
  confidence_pct: number;
  severity: string;
  explanation: string;
  recommended_action: string;
  layer_caused: string;
  forensics?: {
    rms_g?: number;
    peak_g?: number;
    kurtosis?: number;
    crest_factor?: number;
    dominant_freq_hz?: number;
    anomaly_score?: number;
    warn_threshold?: number;
    critical_threshold?: number;
    commanded_rpm?: number;
    measured_rpm?: number;
    speed_deviation_rpm?: number;
    model_version?: string;
    layer_caused?: string;
    trip_reason?: string;
    timestamp?: string;
  };
  resolved: boolean;
  resolved_by?: string;
  resolved_at?: string;
  resolution_notes?: string;
}

export interface ToolHealthInfo {
  health_index_pct: number;
  stage: string;
  stage_color: string;
  estimated_cycles_remaining: number;
  diagnostic_note: string;
}

export interface SimulatorState {
  is_running: boolean;
  scenario: string;
  exciter_amplitude: number;
  exciter_freq_hz: number;
  commanded_speed_pct: number;
  virtual_rpm: number;
  last_seq: number;
  is_dropout: boolean;
  is_packet_loss: boolean;
  indicator_light: IndicatorLightColor;
  station_state: StationState;
}

export interface MLModel {
  id: string;
  version: string;
  model_type: string;
  metrics: {
    roc_auc?: number;
    accuracy?: number;
    precision?: number;
    recall?: number;
    confusion_matrix?: number[][];
    histogram?: {
      bins: number[];
      normal_counts: number[];
      disturbed_counts: number[];
    };
    normal_samples?: number;
    disturbed_samples?: number;
  };
  thresholds: {
    warn_threshold: number;
    critical_threshold: number;
  };
  active_flag: boolean;
  created_at: string;
}

export interface RecordingItem {
  id: string;
  name: string;
  label: 'normal' | 'disturbed';
  sample_count: number;
  duration_sec: number;
  file_path: string;
  created_at: string;
}

export interface EventLogItem {
  id: number;
  ts: string;
  event_type: string;
  details: string;
  operator?: string;
  notes?: string;
}

export interface HierarchyNode {
  id: string;
  name: string;
  plants?: {
    id: string;
    name: string;
    location: string;
    lines?: {
      id: string;
      name: string;
      stations?: {
        id: string;
        name: string;
        state: string;
        devices?: {
          id: string;
          name: string;
          type: string;
          is_active: boolean;
        }[];
      }[];
    }[];
  }[];
}

export interface AuditLogItem {
  id: number;
  username: string;
  action: string;
  resource: string;
  details: string;
  ts: string;
}
