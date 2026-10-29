const API_BASE = '/api/v1';

function getHeaders(customHeaders: Record<string, string> = {}) {
  const token = localStorage.getItem('tool_monitor_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...customHeaders,
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export const api = {
  // Auth
  async login(username: string, password: string) {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: (username || '').trim(), password }),
      });
    } catch (netErr: any) {
      throw new Error('Unable to connect to backend server. Please verify the backend is running.');
    }

    if (!res.ok) {
      let errorMsg = 'Incorrect username or password';
      try {
        const err = await res.json();
        if (err && err.detail) {
          errorMsg = typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail);
        }
      } catch {
        if (res.status === 401) {
          errorMsg = 'Incorrect username or password';
        } else if (res.status === 502 || res.status === 503) {
          errorMsg = 'Backend service is temporarily unavailable. Please retry in a few moments.';
        } else {
          errorMsg = `Server error (${res.status}). Please try again.`;
        }
      }
      throw new Error(errorMsg);
    }

    let data: any;
    try {
      data = await res.json();
    } catch {
      throw new Error('Authentication succeeded but received an empty response from server.');
    }

    if (data.access_token) {
      localStorage.setItem('tool_monitor_token', data.access_token);
      localStorage.setItem('tool_monitor_user', JSON.stringify(data));
    }
    return data;
  },

  logout() {
    localStorage.removeItem('tool_monitor_token');
    localStorage.removeItem('tool_monitor_user');
  },

  getCurrentUser() {
    const raw = localStorage.getItem('tool_monitor_user');
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },

  async getMe(username = 'admin') {
    const res = await fetch(`${API_BASE}/auth/me?username=${encodeURIComponent(username)}`, {
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error('Failed to retrieve user profile');
    return res.json();
  },

  async updateProfile(payload: { current_username: string; new_username?: string; email?: string; password?: string }) {
    const res = await fetch(`${API_BASE}/auth/profile`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to update profile');
    }
    const data = await res.json();
    if (data.access_token) {
      localStorage.setItem('tool_monitor_token', data.access_token);
      const currentUser = api.getCurrentUser() || {};
      localStorage.setItem(
        'tool_monitor_user',
        JSON.stringify({
          ...currentUser,
          username: data.username,
          role: data.role,
          email: data.email,
        })
      );
    }
    return data;
  },

  // Station Controls
  async getStations() {
    const res = await fetch(`${API_BASE}/stations`, { headers: getHeaders() });
    return res.json();
  },

  async getStationStatus(stationId: string) {
    const res = await fetch(`${API_BASE}/stations/${stationId}/status`, { headers: getHeaders() });
    return res.json();
  },

  async updateStationThresholds(stationId: string, thresholds: { warn_threshold: number; critical_threshold: number; persistence_windows?: number }) {
    const res = await fetch(`${API_BASE}/stations/${stationId}/thresholds`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(thresholds),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to update thresholds');
    }
    return res.json();
  },

  async resetStation(stationId: string, operator: string, notes?: string, rpm?: number) {
    const res = await fetch(`${API_BASE}/stations/${stationId}/reset`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ action: 'RESET', operator, notes, rpm }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to reset station');
    }
    return res.json();
  },

  async emergencyStop(stationId: string, operator: string, notes?: string) {
    const res = await fetch(`${API_BASE}/stations/${stationId}/stop`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ action: 'STOP', operator, notes }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Emergency stop failed');
    }
    return res.json();
  },

  async stopMotor(stationId: string, notes = 'Manual Motor Stop via Settings / Control API') {
    const user = this.getCurrentUser();
    return this.emergencyStop(stationId, user?.username || 'Operator', notes);
  },

  async restartMotor(stationId: string, notes = 'Manual Motor Restart via Settings / Control API') {
    const user = this.getCurrentUser();
    return this.resetStation(stationId, user?.username || 'Operator', notes);
  },

  async getLatestTripAnalysis(stationId = 'station-A') {
    const res = await fetch(`${API_BASE}/stations/${stationId}/latest-trip-analysis`, {
      headers: getHeaders(),
    });
    if (!res.ok) return null;
    return res.json();
  },

  async getTripHistory(stationId = 'station-A', limit = 20) {
    const res = await fetch(`${API_BASE}/stations/${stationId}/trip-history?limit=${limit}`, {
      headers: getHeaders(),
    });
    if (!res.ok) return [];
    return res.json();
  },

  // Simulator Controls
  async getSimulatorState() {
    const res = await fetch(`${API_BASE}/sim/state`, { headers: getHeaders() });
    return res.json();
  },

  async setSimulatorScenario(data: {
    scenario: string;
    exciter_amplitude?: number;
    exciter_freq_hz?: number;
    commanded_speed_pct?: number;
    random_seed?: number;
  }) {
    const res = await fetch(`${API_BASE}/sim/scenario`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    return res.json();
  },

  // Hardware Motor Control & Telemetry API (Direct Host Actuation)
  async commandMotor(
    command: 'SET_SPEED' | 'REDUCE_SPEED' | 'STOP' | 'RESET',
    rpm?: number,
    stationId: string = 'station-A'
  ) {
    const res = await fetch(`${API_BASE}/motor/command`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        command,
        rpm,
        station_id: stationId,
        forward_to_vendor: true,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Failed to dispatch motor command' }));
      throw new Error(err.detail || 'Failed to dispatch motor command');
    }
    return res.json();
  },

  async getMotorStatus() {
    const res = await fetch(`${API_BASE}/motor/status`, { headers: getHeaders() });
    return res.json();
  },

  async getMotorState() {
    const res = await fetch(`${API_BASE}/motor/state`, { headers: getHeaders() });
    return res.json();
  },

  async getLatestReading(deviceIds?: string[]) {
    let url = `${API_BASE}/readings/latest`;
    if (deviceIds && deviceIds.length > 0) {
      const valid = deviceIds.filter(id => id && id !== 'all');
      if (valid.length > 0) {
        url += `?device_ids=${encodeURIComponent(valid.join(','))}`;
      }
    }
    const res = await fetch(url, { headers: getHeaders() });
    if (!res.ok) return null;
    return res.json();
  },

  async getSelectedDevices(): Promise<string[]> {
    try {
      const res = await fetch(`${API_BASE}/gateway/ble/selected-devices`, { headers: getHeaders() });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data.selected_device_ids) ? data.selected_device_ids : [];
    } catch {
      return [];
    }
  },

  async saveSelectedDevices(deviceIds: string[]): Promise<{ status: string; selected_device_ids: string[] }> {
    const res = await fetch(`${API_BASE}/gateway/ble/selected-devices`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ selected_device_ids: deviceIds }),
    });
    if (!res.ok) {
      throw new Error('Failed to save selected devices to database');
    }
    return res.json();
  },

  async getVibrationLive() {
    const res = await fetch(`${API_BASE}/vibration/live`, { headers: getHeaders() });
    if (!res.ok) return null;
    return res.json();
  },

  async setMotorSpeed(commanded_speed_pct: number, ratedRpm?: number) {
    const base = ratedRpm && ratedRpm > 0 ? ratedRpm : 1500;
    let command: 'SET_SPEED' | 'REDUCE_SPEED' | 'STOP' | 'RESET' = 'SET_SPEED';
    let targetRpm = (commanded_speed_pct / 100) * base;
    if (commanded_speed_pct <= 0) {
      command = 'STOP';
      targetRpm = 0;
    } else if (commanded_speed_pct <= 50) {
      command = 'REDUCE_SPEED';
      targetRpm = base * 0.5;
    } else {
      command = 'SET_SPEED';
      targetRpm = base;
    }
    return this.commandMotor(command, targetRpm);
  },

  async startSimulator() {
    const res = await fetch(`${API_BASE}/sim/start`, { method: 'POST', headers: getHeaders() });
    return res.json();
  },

  async stopSimulator() {
    const res = await fetch(`${API_BASE}/sim/stop`, { method: 'POST', headers: getHeaders() });
    return res.json();
  },

  async getSimState() {
    const res = await fetch(`${API_BASE}/sim/state`, { headers: getHeaders() });
    if (!res.ok) return null;
    return res.json();
  },

  async setSimScenario(payload: {
    scenario: string;
    exciter_amplitude?: number;
    exciter_freq_hz?: number;
    commanded_speed_pct?: number;
    random_seed?: number;
  }) {
    const res = await fetch(`${API_BASE}/sim/scenario`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Failed to update scenario' }));
      throw new Error(err.detail || 'Failed to update simulation scenario');
    }
    return res.json();
  },

  async setSimMotorSpeed(commanded_speed_pct: number) {
    const res = await fetch(`${API_BASE}/sim/motor-speed`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ commanded_speed_pct }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Failed to command speed' }));
      throw new Error(err.detail || 'Failed to set motor speed');
    }
    return res.json();
  },

  // Model Studio
  async listModels() {
    const res = await fetch(`${API_BASE}/models`, { headers: getHeaders() });
    return res.json();
  },

  async getActiveModel() {
    const res = await fetch(`${API_BASE}/models/active`, { headers: getHeaders() });
    return res.json();
  },

  async trainModel(data: {
    model_version: string;
    model_type: string;
    normal_recording_ids: string[];
    disturbed_recording_ids: string[];
    warn_threshold?: number;
    critical_threshold?: number;
    contamination?: number;
  }) {
    const res = await fetch(`${API_BASE}/models/train`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Training failed');
    }
    return res.json();
  },

  async activateModel(version: string) {
    const res = await fetch(`${API_BASE}/models/${version}/activate`, {
      method: 'POST',
      headers: getHeaders(),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Model activation failed');
    }
    return res.json();
  },

  async editModel(version: string, data: { version?: string; warn_threshold?: number; critical_threshold?: number }) {
    const res = await fetch(`${API_BASE}/models/${encodeURIComponent(version)}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Failed to update model' }));
      throw new Error(err.detail || 'Failed to update model');
    }
    return res.json();
  },

  async deleteModel(version: string) {
    const res = await fetch(`${API_BASE}/models/${encodeURIComponent(version)}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Failed to delete model' }));
      throw new Error(err.detail || 'Failed to delete model');
    }
    return res.json();
  },

  async downloadModel(version: string) {
    const res = await fetch(`${API_BASE}/models/${encodeURIComponent(version)}/download`, {
      headers: getHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Failed to download model artifact' }));
      throw new Error(err.detail || 'Download failed');
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${version}.joblib`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  },

  async testModelInference(version?: string) {
    const url = version
      ? `${API_BASE}/models/test-inference?version=${encodeURIComponent(version)}`
      : `${API_BASE}/models/test-inference`;
    const res = await fetch(url, {
      method: 'POST',
      headers: getHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Inference test failed' }));
      throw new Error(err.detail || 'Inference test failed');
    }
    return res.json();
  },

  // Recordings
  async listRecordings() {
    const res = await fetch(`${API_BASE}/recordings`, { headers: getHeaders() });
    return res.json();
  },

  async startRecording(label: string, name: string) {
    const res = await fetch(
      `${API_BASE}/recordings/start?label=${encodeURIComponent(label)}&name=${encodeURIComponent(name)}`,
      { method: 'POST', headers: getHeaders() }
    );
    return res.json();
  },

  async stopRecording(name: string) {
    const res = await fetch(
      `${API_BASE}/recordings/stop?name=${encodeURIComponent(name)}`,
      { method: 'POST', headers: getHeaders() }
    );
    return res.json();
  },

  async getRecording(recId: string) {
    const res = await fetch(`${API_BASE}/recordings/${recId}`, { headers: getHeaders() });
    return res.json();
  },

  async updateRecording(recId: string, data: { name?: string; label?: string }) {
    const res = await fetch(`${API_BASE}/recordings/${recId}`, {
      method: 'PUT',
      headers: { ...getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async deleteRecording(recId: string) {
    const res = await fetch(`${API_BASE}/recordings/${recId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return res.json();
  },

  // Database Explorer & Table Management
  async getDatabaseOverview() {
    const res = await fetch(`${API_BASE}/recordings/database/overview`, { headers: getHeaders() });
    return res.json();
  },

  async getDatabaseFeatures(limit: number = 50, offset: number = 0, search?: string) {
    let url = `${API_BASE}/recordings/database/features?limit=${limit}&offset=${offset}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    const res = await fetch(url, { headers: getHeaders() });
    return res.json();
  },

  async createDatabaseFeature(data: any) {
    const res = await fetch(`${API_BASE}/recordings/database/features`, {
      method: 'POST',
      headers: { ...getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async updateDatabaseFeature(featId: number, data: any) {
    const res = await fetch(`${API_BASE}/recordings/database/features/${featId}`, {
      method: 'PUT',
      headers: { ...getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async deleteDatabaseFeature(featId: number) {
    const res = await fetch(`${API_BASE}/recordings/database/features/${featId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return res.json();
  },

  async getDatabaseDecisions(limit: number = 50, offset: number = 0, stateFilter?: string) {
    let url = `${API_BASE}/recordings/database/decisions?limit=${limit}&offset=${offset}`;
    if (stateFilter) url += `&state_filter=${encodeURIComponent(stateFilter)}`;
    const res = await fetch(url, { headers: getHeaders() });
    return res.json();
  },

  async updateDatabaseDecision(decId: number, data: any) {
    const res = await fetch(`${API_BASE}/recordings/database/decisions/${decId}`, {
      method: 'PUT',
      headers: { ...getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async deleteDatabaseDecision(decId: number) {
    const res = await fetch(`${API_BASE}/recordings/database/decisions/${decId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return res.json();
  },

  async getDatabaseAnomalyScores(limit: number = 50, offset: number = 0) {
    const res = await fetch(`${API_BASE}/recordings/database/anomaly-scores?limit=${limit}&offset=${offset}`, {
      headers: getHeaders(),
    });
    return res.json();
  },

  async updateDatabaseAnomalyScore(scoreId: number, data: any) {
    const res = await fetch(`${API_BASE}/recordings/database/anomaly-scores/${scoreId}`, {
      method: 'PUT',
      headers: { ...getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async deleteDatabaseAnomalyScore(scoreId: number) {
    const res = await fetch(`${API_BASE}/recordings/database/anomaly-scores/${scoreId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return res.json();
  },

  // History & Analytics
  async getFeaturesHistory(limit = 100) {
    const res = await fetch(`${API_BASE}/history/features?limit=${limit}`, { headers: getHeaders() });
    return res.json();
  },

  async getScoresHistory(limit = 100) {
    const res = await fetch(`${API_BASE}/history/scores?limit=${limit}`, { headers: getHeaders() });
    return res.json();
  },

  async getDecisionsHistory(limit = 100) {
    const res = await fetch(`${API_BASE}/history/decisions?limit=${limit}`, { headers: getHeaders() });
    return res.json();
  },

  async getEventsHistory(limit = 50) {
    const res = await fetch(`${API_BASE}/history/events?limit=${limit}`, { headers: getHeaders() });
    return res.json();
  },

  // Admin & Hierarchy
  async getHierarchy() {
    const res = await fetch(`${API_BASE}/admin/hierarchy`, { headers: getHeaders() });
    return res.json();
  },

  async getAuditLogs(limit = 50) {
    const res = await fetch(`${API_BASE}/admin/audit?limit=${limit}`, { headers: getHeaders() });
    return res.json();
  },

  // BLE Gateway API
  async getBleGateways() {
    const res = await fetch(`${API_BASE}/gateway/ble/gateways`, { headers: getHeaders() });
    return res.json();
  },

  async getBleDocs() {
    const res = await fetch(`${API_BASE}/gateway/ble/docs`, { headers: getHeaders() });
    return res.json();
  },

  async getBleLiveStream() {
    const res = await fetch(`${API_BASE}/gateway/ble/live-stream`, { headers: getHeaders() });
    if (!res.ok) return null;
    return res.json();
  },

  async sendBleTelemetry(payload: any) {
    const res = await fetch(`${API_BASE}/gateway/ble/telemetry`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(payload),
    });
    return res.json();
  },

  // Vendor Gateway Connection & Sync API
  async getVendorGatewayConfig() {
    const res = await fetch(`${API_BASE}/gateway/ble/vendor/config`, { headers: getHeaders() });
    return res.json();
  },

  async saveVendorGatewayConfig(config: any) {
    const res = await fetch(`${API_BASE}/gateway/ble/vendor/config`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(config),
    });
    return res.json();
  },

  async syncVendorGatewayNow() {
    const res = await fetch(`${API_BASE}/gateway/ble/vendor/sync-now`, {
      method: 'POST',
      headers: getHeaders(),
    });
    return res.json();
  },

  async resetVendorGatewayToEnv() {
    const res = await fetch(`${API_BASE}/gateway/ble/vendor/reset-to-env`, {
      method: 'POST',
      headers: getHeaders(),
    });
    return res.json();
  },

  async testVendorEndpoint(apiUrl: string, apiKey?: string, vendorType?: string) {
    const res = await fetch(`${API_BASE}/gateway/ble/vendor/test-endpoint`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        api_url: apiUrl,
        api_key: apiKey || null,
        vendor_type: vendorType || 'GenericREST',
      }),
    });
    return res.json();
  },

  async getBleTelemetryLatest(deviceId?: string | string[]) {
    let url = `${API_BASE}/gateway/ble/telemetry/latest`;
    if (deviceId) {
      if (Array.isArray(deviceId)) {
        const validIds = deviceId.filter((id) => id && id !== 'all');
        if (validIds.length > 0) {
          url += `?device_id=${encodeURIComponent(validIds.join(','))}`;
        }
      } else if (deviceId !== 'all') {
        url += `?device_id=${encodeURIComponent(deviceId)}`;
      }
    }
    const res = await fetch(url, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch latest BLE telemetry');
    return res.json();
  },

  async getBleTelemetryHistory(limit: number = 30, deviceId?: string | string[]) {
    let url = `${API_BASE}/gateway/ble/telemetry/history?limit=${limit}`;
    if (deviceId) {
      if (Array.isArray(deviceId)) {
        const validIds = deviceId.filter((id) => id && id !== 'all');
        if (validIds.length > 0) {
          url += `&device_id=${encodeURIComponent(validIds.join(','))}`;
        }
      } else if (deviceId !== 'all') {
        url += `&device_id=${encodeURIComponent(deviceId)}`;
      }
    }
    const res = await fetch(url, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch BLE telemetry history');
    return res.json();
  },

  async getDiscoveredBleDevices() {
    const res = await fetch(`${API_BASE}/gateway/ble/devices`, { headers: getHeaders() });
    if (!res.ok) return { total_devices_coming: 0, total_ble_gateways: 0, devices: [], gateways: [] };
    return res.json();
  },

  async getBleTelemetryStream() {
    const res = await fetch(`${API_BASE}/gateway/ble/telemetry`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch BLE telemetry base stream');
    return res.json();
  },

  // System & Branding Settings
  async getSystemSettings() {
    const res = await fetch(`${API_BASE}/admin/settings`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch system settings');
    return res.json();
  },

  async saveSystemSettings(settings: any) {
    const res = await fetch(`${API_BASE}/admin/settings`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(settings),
    });
    if (!res.ok) throw new Error('Failed to save system settings');
    return res.json();
  },

  // Database Storage & Retention Management
  async getDatabaseStats() {
    const res = await fetch(`${API_BASE}/database/stats`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to retrieve database storage metrics');
    return res.json();
  },

  async cleanupDatabase(retention_period: string, vacuum = true) {
    const res = await fetch(`${API_BASE}/database/cleanup`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ retention_period, vacuum }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Database cleanup failed');
    }
    return res.json();
  },

  async vacuumDatabase() {
    const res = await fetch(`${API_BASE}/database/vacuum`, {
      method: 'POST',
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error('Database vacuum failed');
    return res.json();
  },

  async setDatabaseRetentionPolicy(policy: string) {
    const res = await fetch(`${API_BASE}/database/retention-policy`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ policy }),
    });
    if (!res.ok) throw new Error('Failed to update database retention policy');
    return res.json();
  },

  // Gemini AI Engine Status & Diagnostics
  async getAiStatus() {
    const res = await fetch(`${API_BASE}/database/ai-status`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to query AI engine diagnostics');
    return res.json();
  },
};



