import React, { useState, useEffect } from 'react';
import {
  Radio,
  Wifi,
  CheckCircle2,
  Copy,
  Check,
  RefreshCw,
  Terminal,
  ShieldCheck,
  Settings2,
  Play,
  Pause,
  ShieldAlert,
  Activity,
  AlertTriangle,
  Sparkles,
  Zap,
  Gauge,
  Clock,
  Cpu,
  Filter,
  HardDrive,
  Battery,
  Signal,
  Eye,
  SlidersHorizontal,
  X,
  Layers,
  Search,
  Database,
} from 'lucide-react';
import type {
  BleGateway,
  BleGatewayDocs,
  VendorGatewayConfig,
  VendorSyncResult,
  VendorTestEndpointResult,
  DiscoveredBleDevice,
  BleTelemetryLatestResponse,
} from '../../types';
import { api } from '../../services/api';
import { ENV } from '../../config/env';
import { SmoothNumber } from '../common/SmoothNumber';
import { useAppSettings } from '../../context/AppSettingsContext';

export const BleGatewayView: React.FC = () => {
  const [gateways, setGateways] = useState<BleGateway[]>([]);
  const [docs, setDocs] = useState<BleGatewayDocs | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Vendor Gateway State (strictly persisted to database/backend)
  const [, setVendorConfig] = useState<VendorGatewayConfig | null>(null);
  const [vendorName, setVendorName] = useState<string>('Aperture Industrial BLE Gateway');
  const [vendorType, setVendorType] = useState<string>('GenericREST');
  const [vendorUrl, setVendorUrl] = useState<string>(ENV.VENDOR_BLE_GATEWAY_URL || 'https://gateway.apertureventurestudio.com/api/v1/gateway/ble/telemetry/latest');
  const [vendorApiKey, setVendorApiKey] = useState<string>('');
  const [vendorStationId, setVendorStationId] = useState<string>('station-A');
  const [vendorMacFilter, setVendorMacFilter] = useState<string>('');
  const [vendorPollInterval, setVendorPollInterval] = useState<number>(1.0);
  const [vendorIsActive, setVendorIsActive] = useState<boolean>(true);
  const [isSavingVendor, setIsSavingVendor] = useState<boolean>(false);
  const [isSyncingVendor, setIsSyncingVendor] = useState<boolean>(false);
  const [vendorSyncResult, setVendorSyncResult] = useState<VendorSyncResult | null>(null);
  const [vendorSaveFeedback, setVendorSaveFeedback] = useState<string | null>(null);

  // Vendor URL Live Endpoint Diagnostic State
  const [isTestingEndpoint, setIsTestingEndpoint] = useState<boolean>(false);
  const [testEndpointResult, setTestEndpointResult] = useState<VendorTestEndpointResult | null>(null);

  // Real-Time Live Gateway Telemetry Stream State (100% Authentic API Data)
  const [liveStreamReading, setLiveStreamReading] = useState<any>(null);
  const [isRefreshingStream, setIsRefreshingStream] = useState<boolean>(false);
  const [streamActive, setStreamActive] = useState<boolean>(true);
  const [streamTab, setStreamTab] = useState<'json' | 'kpis' | 'history'>('json');
  const [recentPackets, setRecentPackets] = useState<any[]>([]);
  const [packetCount, setPacketCount] = useState<number>(0);
  const [lastPacketTime, setLastPacketTime] = useState<string>('');
  const [isPacketFlash, setIsPacketFlash] = useState<boolean>(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [activeCodeTab, setActiveCodeTab] = useState<'curl' | 'python' | 'esp32' | 'schema'>('curl');

  // Discovered Devices & Multi-Device Selection Filter State (100% Dynamic & Real-Time)
  const { settings, saveSelectedDevices } = useAppSettings();
  const [discoveredDevices, setDiscoveredDevices] = useState<DiscoveredBleDevice[]>([]);
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>(() => settings.selectedDeviceIds || []);
  const [isSavingSelection, setIsSavingSelection] = useState<boolean>(false);
  const [saveSelectionFeedback, setSaveSelectionFeedback] = useState<string | null>(null);
  const [isSelectionDirty, setIsSelectionDirty] = useState<boolean>(false);
  const [devicesTelemetryMap, setDevicesTelemetryMap] = useState<Record<string, any>>({});
  const [totalDevicesComing, setTotalDevicesComing] = useState<number>(0);
  const [totalBleGateways, setTotalBleGateways] = useState<number>(1);
  const [deviceSearchQuery, setDeviceSearchQuery] = useState<string>('');

  // Keep local selection synchronized with AppSettingsContext if loaded from DB
  useEffect(() => {
    if (Array.isArray(settings.selectedDeviceIds) && settings.selectedDeviceIds.length > 0) {
      setSelectedDeviceIds(settings.selectedDeviceIds);
    }
  }, [settings.selectedDeviceIds]);

  const fetchGatewayData = async () => {
    setIsLoading(true);
    try {
      const [gwList, docsData, vCfg, devInfo] = await Promise.all([
        api.getBleGateways().catch(() => []),
        api.getBleDocs().catch(() => null),
        api.getVendorGatewayConfig().catch(() => null),
        api.getDiscoveredBleDevices().catch(() => null),
      ]);
      if (Array.isArray(gwList)) {
        setGateways(gwList);
        setTotalBleGateways(gwList.length);
      }
      setDocs(docsData);
      if (devInfo && Array.isArray(devInfo.devices) && devInfo.devices.length > 0) {
        setDiscoveredDevices(devInfo.devices);
        setTotalDevicesComing(devInfo.devices.length);
        if (typeof devInfo.total_ble_gateways === 'number') {
          setTotalBleGateways(devInfo.total_ble_gateways);
        }
      }
      if (vCfg && vCfg.id) {
        setVendorConfig(vCfg);
        setVendorName(vCfg.name || 'Primary Industrial BLE Gateway');
        setVendorType(vCfg.vendor_type || 'GenericREST');
        setVendorUrl(vCfg.api_url || '');
        setVendorApiKey(vCfg.api_key || '');
        setVendorStationId(vCfg.station_id || 'station-A');
        setVendorMacFilter(vCfg.mac_filter || '');
        setVendorPollInterval(vCfg.poll_interval_sec || 1.0);
        setVendorIsActive(!!vCfg.is_active);
      }
    } catch (e) {
      console.error('Failed to fetch gateway info', e);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchHistoryPackets = async (targetDeviceIds?: string[]) => {
    const activeIds = targetDeviceIds !== undefined ? targetDeviceIds : selectedDeviceIds;
    try {
      const hist = await api.getBleTelemetryHistory(30, activeIds.length > 0 ? activeIds : undefined).catch(() => null);
      if (hist) {
        if (Array.isArray(hist.history) && hist.history.length > 0) {
          setRecentPackets(hist.history);
        }
        if (Array.isArray(hist.discovered_devices) && hist.discovered_devices.length > 0) {
          setDiscoveredDevices(hist.discovered_devices);
        }
        if (typeof hist.total_devices_coming === 'number') {
          setTotalDevicesComing(hist.total_devices_coming);
        }
      }
    } catch (err) {
      // ignore
    }
  };

  const fetchLiveStreamPacket = async (targetDeviceIds?: string[]) => {
    const activeIds = targetDeviceIds !== undefined ? targetDeviceIds : selectedDeviceIds;
    try {
      const streamRes: BleTelemetryLatestResponse | null = await api
        .getBleTelemetryLatest(activeIds.length > 0 ? activeIds : undefined)
        .catch(() => null);

      if (streamRes) {
        if (typeof streamRes.total_devices_coming === 'number') {
          setTotalDevicesComing(streamRes.total_devices_coming);
        }
        if (typeof streamRes.total_ble_gateways === 'number') {
          setTotalBleGateways(streamRes.total_ble_gateways);
        }
        if (Array.isArray(streamRes.discovered_devices)) {
          setDiscoveredDevices(streamRes.discovered_devices);
          setTotalDevicesComing(streamRes.discovered_devices.length);
        }
        if (Array.isArray(streamRes.active_gateways) && streamRes.active_gateways.length > 0) {
          setGateways(streamRes.active_gateways);
          setTotalBleGateways(streamRes.active_gateways.length);
        }
        if (streamRes.devices_telemetry && typeof streamRes.devices_telemetry === 'object') {
          setDevicesTelemetryMap(streamRes.devices_telemetry);
        }

        if (streamRes.latest_packet || streamRes.telemetry || streamRes.live_reading) {
          const rawPayload = streamRes.latest_packet?.payload || streamRes.telemetry || streamRes.live_reading;
          setLiveStreamReading(rawPayload);
          if (Array.isArray(streamRes.recent_packets)) {
            setRecentPackets(streamRes.recent_packets);
          }
          const liveBatchCount = streamRes.latest_batch_packets ?? streamRes.total_packets ?? 0;
          setPacketCount(liveBatchCount);
          setLastPacketTime(new Date().toLocaleTimeString());
          setIsPacketFlash(true);
          setTimeout(() => setIsPacketFlash(false), 300);
          return;
        }
      }

      const reading = await api.getLatestReading();
      if (reading) {
        setLiveStreamReading(reading);
        setPacketCount((prev: number) => prev + 1);
        setLastPacketTime(new Date().toLocaleTimeString());
        setIsPacketFlash(true);
        setTimeout(() => setIsPacketFlash(false), 300);

        setRecentPackets((prev: any[]) => [
          {
            id: `pkt-${Date.now() % 100000}`,
            timestamp: new Date().toLocaleTimeString(),
            source: 'Aperture BLE Gateway Stream',
            device_id: reading.device_id || (activeIds.length > 0 ? activeIds[0] : (discoveredDevices[0]?.device_id || 'LIVE_NODE')),
            rms: reading.rms_g ?? reading.rms ?? reading.features?.rms ?? 0,
            rpm: reading.measured_rpm ?? reading.motor?.measured_rpm ?? 0,
            state: reading.state ?? 'NORMAL',
            status: reading.motor_status ?? reading.status ?? 'RUNNING',
            score: reading.anomaly_score ?? 0,
            payload: reading,
          },
          ...prev.slice(0, 14),
        ]);
      }
    } catch (err) {
      // ignore
    }
  };

  const handleToggleDevice = (devId: string) => {
    let next: string[];
    if (devId === 'all') {
      next = [];
    } else {
      const exists = selectedDeviceIds.includes(devId);
      next = exists ? selectedDeviceIds.filter((id) => id !== devId) : [...selectedDeviceIds, devId];
    }
    setSelectedDeviceIds(next);
    setIsSelectionDirty(true);
    // Automatically persist to database SystemSetting
    saveSelectedDevices(next).then(() => {
      setIsSelectionDirty(false);
      setSaveSelectionFeedback(next.length > 0 ? `Saved: ${next.length} hardware device(s) active in DB` : 'Saved: All devices active in DB');
      setTimeout(() => setSaveSelectionFeedback(null), 3000);
    }).catch(() => {});
    fetchLiveStreamPacket(next);
    fetchHistoryPackets(next);
  };

  const handleSelectAllDevices = () => {
    const allIds = discoveredDevices.map((d) => d.device_id);
    setSelectedDeviceIds(allIds);
    setIsSelectionDirty(true);
    saveSelectedDevices(allIds).then(() => {
      setIsSelectionDirty(false);
      setSaveSelectionFeedback(`Saved all ${allIds.length} device(s) to DB`);
      setTimeout(() => setSaveSelectionFeedback(null), 3000);
    }).catch(() => {});
    fetchLiveStreamPacket(allIds);
    fetchHistoryPackets(allIds);
  };

  const handleClearSelection = () => {
    setSelectedDeviceIds([]);
    setIsSelectionDirty(true);
    saveSelectedDevices([]).then(() => {
      setIsSelectionDirty(false);
      setSaveSelectionFeedback('Cleared filter & saved to DB');
      setTimeout(() => setSaveSelectionFeedback(null), 3000);
    }).catch(() => {});
    fetchLiveStreamPacket([]);
    fetchHistoryPackets([]);
  };

  const handleSaveSelectionToDb = async () => {
    setIsSavingSelection(true);
    setSaveSelectionFeedback(null);
    try {
      await saveSelectedDevices(selectedDeviceIds);
      setIsSelectionDirty(false);
      setSaveSelectionFeedback(
        selectedDeviceIds.length > 0
          ? `Saved! Telemetry across all pages now filtered exclusively to ${selectedDeviceIds.length} device(s).`
          : 'Saved! Showing data from all discovered devices across all pages.'
      );
      setTimeout(() => setSaveSelectionFeedback(null), 4000);
    } catch (err: any) {
      setSaveSelectionFeedback('Failed to save to database. Please retry.');
    } finally {
      setIsSavingSelection(false);
    }
  };

  useEffect(() => {
    fetchGatewayData();
    fetchLiveStreamPacket(selectedDeviceIds);
    const interval = setInterval(() => {
      fetchGatewayData();
      if (streamActive) {
        fetchLiveStreamPacket(selectedDeviceIds);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [streamActive, selectedDeviceIds]);

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleSaveVendorConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingVendor(true);
    setVendorSaveFeedback(null);
    try {
      const res = await api.saveVendorGatewayConfig({
        name: vendorName,
        vendor_type: vendorType,
        api_url: vendorUrl,
        api_key: vendorApiKey,
        poll_interval_sec: Number(vendorPollInterval),
        station_id: vendorStationId,
        mac_filter: vendorMacFilter,
        is_active: vendorIsActive,
      });
      setVendorSaveFeedback(res.message || 'Configuration persisted to database successfully.');
      setTimeout(() => setVendorSaveFeedback(null), 4000);
      await fetchGatewayData();
    } catch (err: any) {
      alert(err.message || 'Failed to save vendor gateway configuration');
    } finally {
      setIsSavingVendor(false);
    }
  };

  const handleSyncVendorNow = async () => {
    setIsSyncingVendor(true);
    setVendorSyncResult(null);
    try {
      const res = await api.syncVendorGatewayNow();
      setVendorSyncResult(res);
      await fetchGatewayData();
    } catch (err: any) {
      setVendorSyncResult({
        status: 'error',
        message: err.message || 'Vendor sync request failed',
        latency_ms: 0,
      });
    } finally {
      setIsSyncingVendor(false);
    }
  };

  const handleResetToEnv = async () => {
    setIsSavingVendor(true);
    try {
      const res = await api.resetVendorGatewayToEnv();
      setVendorSaveFeedback(res.message || 'Reset to .env configuration successfully.');
      setTimeout(() => setVendorSaveFeedback(null), 4000);
      await fetchGatewayData();
    } catch (err: any) {
      alert(err.message || 'Failed to reset to .env configuration');
    } finally {
      setIsSavingVendor(false);
    }
  };

  const handleTestEndpoint = async () => {
    if (!vendorUrl.trim()) {
      alert('Please enter a Vendor API URL to test.');
      return;
    }
    setIsTestingEndpoint(true);
    setTestEndpointResult(null);
    try {
      const res = await api.testVendorEndpoint(vendorUrl.trim(), vendorApiKey, vendorType);
      setTestEndpointResult(res);
    } catch (err: any) {
      setTestEndpointResult({
        status: 'error',
        message: err.message || 'Failed to reach vendor endpoint',
        latency_ms: 0,
        error_detail: String(err),
      });
    } finally {
      setIsTestingEndpoint(false);
    }
  };

  const handleRefreshLiveStream = async () => {
    setIsRefreshingStream(true);
    try {
      await fetchLiveStreamPacket();
      await fetchGatewayData();
    } catch (err: any) {
      console.error('Failed to refresh live stream', err);
    } finally {
      setIsRefreshingStream(false);
    }
  };

  const esp32Code = `// ESP32 Industrial BLE-to-HTTP Gateway Firmware Snippet
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

const char* ssid = "Plant_Industrial_WiFi";
const char* password = "PlantSecurePassword123";
const char* serverUrl = "http://192.168.4.10:8000/api/v1/gateway/ble/telemetry";

void sendBleTelemetryToBackend(float* samples, int sampleCount, float rpm) {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(serverUrl);
    http.addHeader("Content-Type", "application/json");

    StaticJsonDocument<4096> doc;
    doc["gateway_id"] = "gw-ble-01";
    doc["device_mac"] = "304A2657BF44";
    doc["station_id"] = "station-A";
    doc["seq"] = (int)millis();
    doc["sample_rate_hz"] = 1000;
    doc["rssi"] = -73.0;
    doc["battery_pct"] = 98.0;
    doc["motor_rpm"] = rpm;
    doc["motor_commanded_pct"] = 100.0;

    JsonArray raw = doc.createNestedArray("raw_samples");
    for (int i = 0; i < sampleCount; i++) {
      raw.add(samples[i]);
    }

    String requestBody;
    serializeJson(doc, requestBody);
    int httpResponseCode = http.POST(requestBody);

    if (httpResponseCode == 200) {
      String response = http.getString();
      // Parse motor control reaction (Speed % & Stop commands)
      StaticJsonDocument<512> resDoc;
      deserializeJson(resDoc, response);
      float speedPct = resDoc["commanded_speed_pct"];
      const char* state = resDoc["state"];
      Serial.printf("Server Response: State=%s, Speed=%.1f%%\\n", state, speedPct);
    }
    http.end();
  }
}`;

  const jsonSchema = `// ============================================================
// FORMAT 1: APERTURE BLE GATEWAY advData PACKET (PRODUCTION ENDPOINT)
// Source: https://gateway.apertureventurestudio.com/api/v1/gateway/ble/telemetry/latest
// ============================================================
{
  "msg": "advData",
  "gmac": "304A2657BF44",
  "obj": [
    {
      "dmac": "535E530AF2B8",             // Sensor Node DMAC
      "type": 32,                         // Raw BLE telemetry
      "rssi": -73,                        // Signal strength (dBm)
      "time": "2026-10-14 15:44:33",      // Timestamp (UTC/local)
      "vbatt": 3040,                      // Battery voltage (mV) -> 92.1%
      "temp": 26.5,                       // Operating temperature (°C)
      "data1": "0201060319C0030609..."     // Accelerometer raw frame
    }
  ]
}

// ============================================================
// FORMAT 2: DEDICATED INDUSTRIAL INGESTION CONTRACT
// Target Endpoint: POST /api/v1/gateway/ble/telemetry
// ============================================================
{
  "gateway_id": "gw-ble-01",              // Unique Gateway ID
  "device_mac": "304A2657BF44",           // BLE Accelerometer Sensor MAC
  "station_id": "station-A",              // Target Fastening Spindle / Station
  "seq": 10245,                           // Monotonically increasing sequence number
  "sample_rate_hz": 1000,                 // Vibration acquisition frequency (Hz)
  "rssi": -73.0,                          // Signal strength (dBm)
  "battery_pct": 98.0,                    // Node battery remaining (0-100%)
  "raw_samples": [0.012, -0.024, ...],    // 1000-point time-domain acceleration array in 'g'
  "motor_rpm": 1500.0,                    // Current spindle speed feedback (RPM)
  "motor_commanded_pct": 100.0,           // PLC commanded speed percent (0-100%)
  "motor_current_a": 4.1                  // Motor current consumption (Amperes)
  "battery_pct": 98.0,                    // Node battery remaining (0-100%)
  "raw_samples": [0.012, -0.024, ...],    // 1000-point time-domain acceleration array in 'g'
  "motor_rpm": 1500.0,                    // Current spindle speed feedback (RPM)
  "motor_commanded_pct": 100.0,           // PLC commanded speed percent (0-100%)
  "motor_current_a": 4.1                  // Motor current consumption (Amperes)
}`;

  // Dynamically normalize telemetry fields from liveStreamReading
  const rawRms = Number(liveStreamReading?.rms_g ?? liveStreamReading?.rms ?? liveStreamReading?.features?.rms ?? 0);
  const rawPeak = Number(liveStreamReading?.peak_g ?? liveStreamReading?.peak ?? liveStreamReading?.features?.peak ?? 0);
  const rawCrest = Number(liveStreamReading?.crest_factor ?? liveStreamReading?.features?.crest_factor ?? (rawRms > 0 ? rawPeak / rawRms : 0));
  const rawKurt = Number(liveStreamReading?.kurtosis ?? liveStreamReading?.features?.kurtosis ?? 0);
  const rawX = Number(liveStreamReading?.acc_x_g ?? liveStreamReading?.x ?? liveStreamReading?.features?.acc_x ?? 0);
  const rawY = Number(liveStreamReading?.acc_y_g ?? liveStreamReading?.y ?? liveStreamReading?.features?.acc_y ?? 0);
  const rawZ = Number(liveStreamReading?.acc_z_g ?? liveStreamReading?.z ?? liveStreamReading?.features?.acc_z ?? 0);
  const rawRpm = Number(liveStreamReading?.measured_rpm ?? liveStreamReading?.motor?.measured_rpm ?? 0);
  const rawMotorStatus = String(liveStreamReading?.motor_status ?? liveStreamReading?.status ?? (liveStreamReading ? 'RUNNING' : 'OFF')).toUpperCase();
  const rawState = String(liveStreamReading?.state ?? (rawMotorStatus === 'OFF' ? 'STOPPED' : rawMotorStatus === 'SLOW' ? 'REDUCED_SPEED' : 'NORMAL')).toUpperCase();
  const rawLight = String(liveStreamReading?.indicator_light ?? (rawState === 'STOPPED' ? 'RED' : rawState === 'REDUCED_SPEED' ? 'AMBER' : 'GREEN')).toUpperCase();
  const rawSpeedPct = Number(liveStreamReading?.commanded_speed_pct ?? (rawState === 'STOPPED' ? 0 : rawState === 'REDUCED_SPEED' ? 50 : 100));
  const rawScore = Number(liveStreamReading?.anomaly_score ?? liveStreamReading?.smoothed_anomaly_score ?? 0);
  const rawBatt = Number(liveStreamReading?.battery_pct ?? (liveStreamReading?.vbatt ? ((liveStreamReading.vbatt / 3300) * 100) : 0));
  const rawBattMv = Number(liveStreamReading?.vbatt ?? Math.round((rawBatt / 100) * 3300));
  const rawTemp = Number(liveStreamReading?.temperature ?? liveStreamReading?.temp ?? 0);
  const rawRssi = Number(liveStreamReading?.rssi ?? 0);
  const rawDevice = String(liveStreamReading?.device_id ?? liveStreamReading?.device_mac ?? vendorMacFilter ?? (discoveredDevices[0]?.device_id || ''));
  const rawTimestamp = String(liveStreamReading?.timestamp ?? liveStreamReading?.ts ?? new Date().toISOString());

  const isAllSelected = selectedDeviceIds.length === 0;
  const isSingleSelected = selectedDeviceIds.length === 1;
  const isMultiSelected = selectedDeviceIds.length > 1;

  // Selected device metadata resolution for strict visual isolation
  const selectedDeviceMeta = isSingleSelected
    ? discoveredDevices.find((d) => d.device_id === selectedDeviceIds[0])
    : undefined;

  const displayDevice = isAllSelected
    ? rawDevice
    : isSingleSelected
    ? selectedDeviceIds[0]
    : `${selectedDeviceIds.length} Devices (${selectedDeviceIds.slice(0, 2).join(', ')}${selectedDeviceIds.length > 2 ? '...' : ''})`;

  const displayRssi = isSingleSelected && selectedDeviceMeta ? selectedDeviceMeta.rssi : rawRssi;
  const displayBatt = isSingleSelected && selectedDeviceMeta ? selectedDeviceMeta.battery_pct : rawBatt;
  const displayBattMv = isSingleSelected && selectedDeviceMeta ? Math.round((selectedDeviceMeta.battery_pct / 100) * 3300) : rawBattMv;
  const displayTemp = isSingleSelected && selectedDeviceMeta && selectedDeviceMeta.temperature ? selectedDeviceMeta.temperature : rawTemp;

  // Filtered packets strictly reflecting the selected devices
  const filteredPackets = isAllSelected
    ? recentPackets
    : recentPackets.filter((pkt) => {
        const pDev = pkt.device_id || (pkt.payload && (pkt.payload.device_id || pkt.payload.dmac)) || pkt.gmac;
        return selectedDeviceIds.includes(pDev);
      });

  const searchedDevices = discoveredDevices.filter((d) => {
    if (!deviceSearchQuery.trim()) return true;
    const q = deviceSearchQuery.toLowerCase();
    return (
      d.device_id.toLowerCase().includes(q) ||
      d.name.toLowerCase().includes(q) ||
      d.station_id.toLowerCase().includes(q)
    );
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', width: '100%' }}>
      {/* Top Banner */}
      <div
        style={{
          background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          padding: '1.5rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.25rem' }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 8,
                background: '#0284c7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
              }}
            >
              <Radio size={22} />
            </div>
            <div>
              <h2 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#0f172a', margin: 0 }}>
                Vendor BLE Gateway Integration & Closed-Loop Control
              </h2>
              <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
                Hardware-Agnostic Bridging &bull; REST, Push & Polling &bull; Automated Motor Throttle & Safe Stop
              </span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              background: '#ecfdf5',
              border: '1px solid #a7f3d0',
              padding: '0.4rem 0.8rem',
              borderRadius: 6,
              fontSize: '0.8rem',
              color: '#065f46',
              fontWeight: 600,
            }}
          >
            <CheckCircle2 size={16} color="#10b981" />
            <span>Ingestion Server: Online (Port 8000)</span>
          </div>

          <button
            onClick={fetchGatewayData}
            disabled={isLoading}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              background: '#ffffff',
              border: '1px solid #cbd5e1',
              borderRadius: 6,
              padding: '0.45rem 0.8rem',
              fontSize: '0.8rem',
              fontWeight: 600,
              cursor: 'pointer',
              color: '#334155',
            }}
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Closed-Loop Safety Mechanism Architecture Banner */}
      <div
        style={{
          background: '#f8fafc',
          border: '1px solid #cbd5e1',
          borderRadius: 10,
          padding: '1.25rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <ShieldAlert size={18} color="#0284c7" />
          <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#0f172a' }}>
            Closed-Loop AI Vibration Anomaly &rarr; Automated Motor Speed Control Workflow
          </h4>
        </div>
        <p style={{ fontSize: '0.825rem', color: '#64748b', margin: '0 0 1rem 0' }}>
          When raw vibration frames arrive from the physical BLE gateway, the AI engine extracts statistical & FFT features.
          If any disturbance occurs, the software immediately commands the tool/actuator:
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.75rem' }}>
          <div style={{ background: '#ffffff', border: '1px solid #bbf7d0', borderRadius: 8, padding: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#16a34a', fontWeight: 700, fontSize: '0.85rem' }}>
              <span>●</span>
              <span>Nominal Baseline</span>
            </div>
            <div style={{ fontSize: '0.75rem', color: '#334155', marginTop: '0.25rem' }}>
              Anomaly Score &lt; 0.45 &bull; Full speed (100.0% Rated RPM) &bull; Green Tower Beacon.
            </div>
          </div>

          <div style={{ background: '#ffffff', border: '1px solid #fed7aa', borderRadius: 8, padding: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#ea580c', fontWeight: 700, fontSize: '0.85rem' }}>
              <span>▲</span>
              <span>Vibration Warning &rarr; Speed Reduction</span>
            </div>
            <div style={{ fontSize: '0.75rem', color: '#334155', marginTop: '0.25rem' }}>
              Score &ge; 0.45 for 3 windows &bull; Software commands <strong>50.0% speed throttle</strong> &bull; Amber Light.
            </div>
          </div>

          <div style={{ background: '#ffffff', border: '1px solid #fecaca', borderRadius: 8, padding: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#dc2626', fontWeight: 700, fontSize: '0.85rem' }}>
              <span>■</span>
              <span>Critical Anomaly &rarr; Immediate Stop</span>
            </div>
            <div style={{ fontSize: '0.75rem', color: '#334155', marginTop: '0.25rem' }}>
              Score &ge; 0.70 or RMS &ge; 1.25g &bull; Power cut to <strong>0% (STOPPED)</strong> &bull; Lockout requires Reset.
            </div>
          </div>
        </div>
      </div>

      {/* VENDOR BLE GATEWAY CONFIGURATION & LIVE SYNC PANEL */}
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          padding: '1.5rem',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <Settings2 size={20} color="#0284c7" />
            <div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>
                Vendor BLE Gateway API Configuration
              </h3>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                Configure connection parameters for your vendor gateway (Cassia, Minew, Nordic, Teltonika, or REST).
                Stored in database table <code>vendor_gateways</code>.
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={handleTestEndpoint}
              disabled={isTestingEndpoint || !vendorUrl.trim()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                background: '#f8fafc',
                color: '#0284c7',
                border: '1px solid #cbd5e1',
                borderRadius: 6,
                padding: '0.5rem 0.9rem',
                fontSize: '0.8rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
              title="Test endpoint reachability, HTTP status code and latency without triggering safety ingestion"
            >
              <Activity size={14} className={isTestingEndpoint ? 'animate-spin' : ''} />
              <span>{isTestingEndpoint ? 'Probing URL...' : 'Check / Probe URL'}</span>
            </button>

            <button
              onClick={handleSyncVendorNow}
              disabled={isSyncingVendor}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                background: '#0284c7',
                color: '#ffffff',
                border: 'none',
                borderRadius: 6,
                padding: '0.5rem 1rem',
                fontSize: '0.8rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              <Play size={14} className={isSyncingVendor ? 'animate-spin' : ''} />
              <span>{isSyncingVendor ? 'Connecting...' : 'Sync & Ingest Now'}</span>
            </button>
          </div>
        </div>

        {vendorSaveFeedback && (
          <div
            style={{
              background: '#ecfdf5',
              border: '1px solid #a7f3d0',
              color: '#065f46',
              padding: '0.6rem 0.9rem',
              borderRadius: 6,
              fontSize: '0.8rem',
              marginBottom: '1rem',
              fontWeight: 600,
            }}
          >
            ✓ {vendorSaveFeedback}
          </div>
        )}

        {/* Configuration Form */}
        <form onSubmit={handleSaveVendorConfig}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' }}>
                Gateway Friendly Name
              </label>
              <input
                type="text"
                value={vendorName}
                onChange={(e) => setVendorName(e.target.value)}
                placeholder="e.g. Line 04 Vendor BLE Gateway"
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  borderRadius: 6,
                  border: '1px solid #cbd5e1',
                  fontSize: '0.85rem',
                }}
                required
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' }}>
                Vendor Protocol / Device Type
              </label>
              <select
                value={vendorType}
                onChange={(e) => setVendorType(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  borderRadius: 6,
                  border: '1px solid #cbd5e1',
                  fontSize: '0.85rem',
                  background: '#ffffff',
                  fontWeight: 600,
                }}
              >
                <option value="GenericREST">Generic Industrial REST API (HTTP GET/POST)</option>
                <option value="Cassia">Cassia IoT Gateway REST Controller</option>
                <option value="Minew">Minew BLE Gateway JSON Forwarder</option>
                <option value="Nordic">Nordic nRF Cloud / Gateway API</option>
                <option value="Teltonika">Teltonika Industrial BLE Gateway</option>
              </select>
            </div>

            <div style={{ gridColumn: 'span 2' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569' }}>
                  Vendor Gateway API Endpoint URL (for vibration telemetry ingestion)
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 500 }}>Quick Presets:</span>
                  <button
                    type="button"
                    onClick={() => {
                      setVendorUrl(ENV.VENDOR_BLE_GATEWAY_URL);
                      setVendorType('GenericREST');
                    }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                      background: vendorUrl === ENV.VENDOR_BLE_GATEWAY_URL ? '#e0f2fe' : '#f1f5f9',
                      color: vendorUrl === ENV.VENDOR_BLE_GATEWAY_URL ? '#0369a1' : '#334155',
                      border: vendorUrl === ENV.VENDOR_BLE_GATEWAY_URL ? '1px solid #7dd3fc' : '1px solid #cbd5e1',
                      borderRadius: 4,
                      padding: '0.2rem 0.5rem',
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                    title="Load Cloud Run hardware simulation endpoint (/api/simulation/hardware)"
                  >
                    <Sparkles size={11} color="#0284c7" />
                    <span>Cloud Run Hardware</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setVendorUrl(ENV.VENDOR_LIVE_VIBRATION_URL);
                      setVendorType('GenericREST');
                    }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                      background: vendorUrl === ENV.VENDOR_LIVE_VIBRATION_URL ? '#e0f2fe' : '#f1f5f9',
                      color: vendorUrl === ENV.VENDOR_LIVE_VIBRATION_URL ? '#0369a1' : '#334155',
                      border: vendorUrl === ENV.VENDOR_LIVE_VIBRATION_URL ? '1px solid #7dd3fc' : '1px solid #cbd5e1',
                      borderRadius: 4,
                      padding: '0.2rem 0.5rem',
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                    title="Load Cloud Run live vibration endpoint (/api/vibration/live)"
                  >
                    <span>Cloud Run Live</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setVendorUrl('http://192.168.4.150:8080/api/v1/ble/telemetry');
                      setVendorType('Cassia');
                    }}
                    style={{
                      background: '#f1f5f9',
                      color: '#475569',
                      border: '1px solid #cbd5e1',
                      borderRadius: 4,
                      padding: '0.2rem 0.5rem',
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Plant Subnet
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setVendorUrl('http://127.0.0.1:8000/api/v1/vibration/live');
                      setVendorType('GenericREST');
                    }}
                    style={{
                      background: '#f1f5f9',
                      color: '#475569',
                      border: '1px solid #cbd5e1',
                      borderRadius: 4,
                      padding: '0.2rem 0.5rem',
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                    title="Local FastAPI live vibration endpoint"
                  >
                    Local Loopback
                  </button>
                  <button
                    type="button"
                    onClick={handleResetToEnv}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                      background: '#fef3c7',
                      color: '#92400e',
                      border: '1px solid #fde68a',
                      borderRadius: 4,
                      padding: '0.2rem 0.5rem',
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                    title="Restore configuration directly from .env file into database"
                  >
                    <span>Reset to .env</span>
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  value={vendorUrl}
                  onChange={(e) => setVendorUrl(e.target.value)}
                  placeholder={ENV.VENDOR_BLE_GATEWAY_URL || "https://your-vendor-gateway.run.app/api/vibration/live"}
                  style={{
                    flex: 1,
                    padding: '0.55rem',
                    borderRadius: 6,
                    border: '1px solid #cbd5e1',
                    fontSize: '0.825rem',
                    fontFamily: 'monospace',
                  }}
                  required
                />
                <button
                  type="button"
                  onClick={handleTestEndpoint}
                  disabled={isTestingEndpoint || !vendorUrl.trim()}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    background: '#0284c7',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: 6,
                    padding: '0.5rem 1rem',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                  title="Probe this URL directly from backend to check reachability and latency"
                >
                  <Activity size={14} className={isTestingEndpoint ? 'animate-spin' : ''} />
                  <span>{isTestingEndpoint ? 'Testing...' : 'Check / Test URL'}</span>
                </button>
              </div>

              {/* Realtime Vendor URL Live Endpoint Diagnostic Box */}
              {testEndpointResult && (
                <div
                  style={{
                    marginTop: '0.65rem',
                    background:
                      testEndpointResult.status === 'success'
                        ? '#f0fdf4'
                        : testEndpointResult.status === 'warning'
                          ? '#fffbeb'
                          : '#fef2f2',
                    border: `1px solid ${testEndpointResult.status === 'success'
                        ? '#86efac'
                        : testEndpointResult.status === 'warning'
                          ? '#fde68a'
                          : '#fca5a5'
                      }`,
                    borderRadius: 8,
                    padding: '0.85rem 1rem',
                    fontSize: '0.8rem',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '0.4rem',
                      flexWrap: 'wrap',
                      gap: '0.5rem',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        fontWeight: 700,
                        color:
                          testEndpointResult.status === 'success'
                            ? '#166534'
                            : testEndpointResult.status === 'warning'
                              ? '#92400e'
                              : '#991b1b',
                      }}
                    >
                      {testEndpointResult.status === 'success' && <CheckCircle2 size={16} />}
                      {testEndpointResult.status === 'warning' && <AlertTriangle size={16} />}
                      {testEndpointResult.status === 'error' && <ShieldAlert size={16} />}
                      <span>
                        {testEndpointResult.status === 'success' && 'Endpoint Reachable & Verified'}
                        {testEndpointResult.status === 'warning' &&
                          `Server Responded (HTTP ${testEndpointResult.http_status})`}
                        {testEndpointResult.status === 'error' && 'Endpoint Unreachable / Network Error'}
                      </span>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.6rem',
                        fontSize: '0.75rem',
                        fontFamily: 'monospace',
                      }}
                    >
                      <span
                        style={{
                          background: '#ffffff',
                          padding: '0.15rem 0.45rem',
                          borderRadius: 4,
                          border: '1px solid #cbd5e1',
                          color: '#0f172a',
                        }}
                      >
                        Round-Trip Latency: <strong>{testEndpointResult.latency_ms} ms</strong>
                      </span>
                      {testEndpointResult.http_status && (
                        <span
                          style={{
                            background: '#ffffff',
                            padding: '0.15rem 0.45rem',
                            borderRadius: 4,
                            border: '1px solid #cbd5e1',
                            color: '#0f172a',
                          }}
                        >
                          Status: <strong>HTTP {testEndpointResult.http_status}</strong>
                        </span>
                      )}
                    </div>
                  </div>

                  <div style={{ color: '#334155', marginBottom: '0.4rem', lineHeight: 1.4 }}>
                    {testEndpointResult.message}
                  </div>

                  {testEndpointResult.http_status === 404 && (
                    <div
                      style={{
                        background: '#ffffff',
                        border: '1px solid #fed7aa',
                        borderRadius: 6,
                        padding: '0.5rem 0.75rem',
                        fontSize: '0.75rem',
                        color: '#9a3412',
                        marginBottom: '0.4rem',
                      }}
                    >
                      <strong>Route Diagnostic:</strong> The Cloud Run host was reached successfully in{' '}
                      {testEndpointResult.latency_ms}ms, but returned <code>404 Not Found</code>.
                      Verify the exact path exposed by your Cloud Run container or check if the live telemetry route
                      requires trailing slashes or authentication headers.
                    </div>
                  )}

                  {(testEndpointResult.is_html || (typeof testEndpointResult.data_preview === 'string' && (testEndpointResult.data_preview.includes('Starting Server') || testEndpointResult.data_preview.includes('<!doctype') || testEndpointResult.data_preview.includes('<html')))) && (
                    <div
                      style={{
                        background: '#ffffff',
                        border: '1px solid #fed7aa',
                        borderRadius: 6,
                        padding: '0.65rem 0.85rem',
                        fontSize: '0.75rem',
                        color: '#9a3412',
                        marginBottom: '0.5rem',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontWeight: 700, color: '#c2410c', marginBottom: '0.25rem' }}>
                        <AlertTriangle size={15} color="#ea580c" />
                        <span>Cloud Run Container Returned HTML Warmup Page (No Live JSON Yet)</span>
                      </div>
                      <div style={{ color: '#431407', marginBottom: '0.5rem', lineHeight: 1.4 }}>
                        The remote Cloud Run host returned an HTML loading page (<code>&lt;title&gt;Starting Server...&lt;/title&gt;</code>) because the remote service is spinning up.
                        To view active live API vibration data stream immediately, switch to the active local loopback endpoint below:
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const localUrl = 'http://127.0.0.1:8000/api/v1/vibration/live';
                          setVendorUrl(localUrl);
                          setVendorType('GenericREST');
                          api.testVendorEndpoint(localUrl, '', 'GenericREST').then((res) => setTestEndpointResult(res));
                        }}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          background: '#0284c7',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: 4,
                          padding: '0.35rem 0.75rem',
                          fontSize: '0.725rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        <Zap size={12} />
                        <span>Switch to Local API Stream ({'http://127.0.0.1:8000/api/v1/vibration/live'})</span>
                      </button>
                    </div>
                  )}

                  {testEndpointResult.data_preview && (
                    <div style={{ marginTop: '0.4rem' }}>
                      <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600, marginBottom: '0.2rem' }}>
                        Response Preview{' '}
                        {testEndpointResult.detected_samples
                          ? `(${testEndpointResult.detected_samples} vibration samples detected)`
                          : ''}
                        :
                      </div>
                      <pre
                        style={{
                          margin: 0,
                          padding: '0.5rem',
                          background: '#0f172a',
                          color: '#38bdf8',
                          borderRadius: 6,
                          fontSize: '0.725rem',
                          overflowX: 'auto',
                          maxHeight: '120px',
                        }}
                      >
                        {typeof testEndpointResult.data_preview === 'string'
                          ? testEndpointResult.data_preview
                          : JSON.stringify(testEndpointResult.data_preview, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' }}>
                API Bearer Token / Gateway Key (Optional)
              </label>
              <input
                type="password"
                value={vendorApiKey}
                onChange={(e) => setVendorApiKey(e.target.value)}
                placeholder="Vendor authentication token"
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  borderRadius: 6,
                  border: '1px solid #cbd5e1',
                  fontSize: '0.85rem',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' }}>
                Target Assembly Station
              </label>
              <input
                type="text"
                value={vendorStationId}
                onChange={(e) => setVendorStationId(e.target.value)}
                placeholder="station-A"
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  borderRadius: 6,
                  border: '1px solid #cbd5e1',
                  fontSize: '0.85rem',
                }}
                required
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' }}>
                Sensor MAC Address Filter
              </label>
              <input
                type="text"
                value={vendorMacFilter}
                onChange={(e) => setVendorMacFilter(e.target.value)}
                placeholder="e.g. 535E530AF2B8 or leave empty for all"
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  borderRadius: 6,
                  border: '1px solid #cbd5e1',
                  fontSize: '0.85rem',
                  fontFamily: 'monospace',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' }}>
                Polling Frequency (Seconds)
              </label>
              <input
                type="number"
                step="0.5"
                min="0.5"
                max="60"
                value={vendorPollInterval}
                onChange={(e) => setVendorPollInterval(parseFloat(e.target.value))}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  borderRadius: 6,
                  border: '1px solid #cbd5e1',
                  fontSize: '0.85rem',
                }}
                required
              />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', paddingTop: '0.75rem', borderTop: '1px solid #f1f5f9' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, color: '#334155' }}>
              <input
                type="checkbox"
                checked={vendorIsActive}
                onChange={(e) => setVendorIsActive(e.target.checked)}
                style={{ width: 16, height: 16 }}
              />
              <span>Enable Background Auto-Polling (Queries vendor gateway at configured interval)</span>
            </label>

            <button
              type="submit"
              disabled={isSavingVendor}
              style={{
                background: '#16a34a',
                color: '#ffffff',
                border: 'none',
                borderRadius: 6,
                padding: '0.55rem 1.25rem',
                fontSize: '0.85rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {isSavingVendor ? 'Saving...' : 'Save Configuration to Database'}
            </button>
          </div>
        </form>

        {/* Vendor Sync Test Feedback Output */}
        {vendorSyncResult && (
          <div
            style={{
              marginTop: '1.25rem',
              background: '#0f172a',
              borderRadius: 8,
              padding: '1.25rem',
              color: '#f8fafc',
              fontSize: '0.8rem',
              fontFamily: 'monospace',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
              <div
                style={{
                  color:
                    vendorSyncResult.status === 'success'
                      ? '#4ade80'
                      : vendorSyncResult.status === 'warning'
                        ? '#fbbf24'
                        : '#f87171',
                  fontWeight: 700,
                }}
              >
                {vendorSyncResult.status === 'success' && '✓ Vendor Connection Successful'}
                {vendorSyncResult.status === 'warning' && '⚠ Vendor Endpoint Warning'}
                {vendorSyncResult.status === 'error' && '✕ Vendor Connection Error'}
              </div>
              <div style={{ color: '#94a3b8' }}>
                Latency: <span style={{ color: '#38bdf8' }}>{vendorSyncResult.latency_ms} ms</span>
              </div>
            </div>

            <div style={{ color: '#cbd5e1', marginBottom: '0.5rem' }}>{vendorSyncResult.message}</div>

            {vendorSyncResult.actuation && (
              <div
                style={{
                  marginTop: '0.75rem',
                  paddingTop: '0.75rem',
                  borderTop: '1px solid #334155',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                  gap: '0.6rem',
                }}
              >
                <div>
                  <span style={{ color: '#94a3b8' }}>Tool State: </span>
                  <span
                    style={{
                      color:
                        vendorSyncResult.actuation.state === 'NORMAL'
                          ? '#4ade80'
                          : vendorSyncResult.actuation.state === 'REDUCED_SPEED'
                            ? '#fbbf24'
                            : '#f87171',
                      fontWeight: 700,
                    }}
                  >
                    {vendorSyncResult.actuation.state}
                  </span>
                </div>
                <div>
                  <span style={{ color: '#94a3b8' }}>Speed Command: </span>
                  <span style={{ color: '#ffffff', fontWeight: 700 }}>
                    {vendorSyncResult.actuation.commanded_speed_pct}%
                  </span>
                </div>
                <div>
                  <span style={{ color: '#94a3b8' }}>Tower Light: </span>
                  <span style={{ color: '#38bdf8', fontWeight: 700 }}>
                    {vendorSyncResult.actuation.indicator_light}
                  </span>
                </div>
                <div>
                  <span style={{ color: '#94a3b8' }}>Anomaly Score: </span>
                  <span style={{ color: '#ffffff', fontWeight: 700 }}>
                    {vendorSyncResult.actuation.anomaly_score?.toFixed(3)}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* REAL-TIME LIVE INBOUND GATEWAY TELEMETRY STREAM & API PACKET MONITOR     */}
      {/* ========================================================================= */}
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #cbd5e1',
          borderRadius: 12,
          padding: '1.5rem',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05)',
          position: 'relative',
        }}
      >
        {/* Stream Header & Live Controls */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 8,
                background: streamActive ? '#e0f2fe' : '#f1f5f9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: streamActive ? '#0284c7' : '#64748b',
              }}
            >
              <Activity size={22} className={streamActive ? 'animate-pulse' : ''} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: '#0f172a', margin: 0 }}>
                  Live Gateway API Data Stream &amp; Packet Inspector
                </h3>
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    background: streamActive ? '#dcfce7' : '#fef3c7',
                    border: `1px solid ${streamActive ? '#86efac' : '#fde68a'}`,
                    color: streamActive ? '#15803d' : '#b45309',
                    borderRadius: 999,
                    padding: '0.15rem 0.6rem',
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                  }}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: streamActive ? '#16a34a' : '#d97706',
                      display: 'inline-block',
                      boxShadow: streamActive && isPacketFlash ? '0 0 8px #22c55e' : 'none',
                    }}
                  />
                  <span>{streamActive ? '● LIVE STREAM ACTIVE (1.0s)' : '⏸ STREAM PAUSED'}</span>
                </div>
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.15rem' }}>
                Streaming live physical telemetry arriving at Gateway &bull; Source: <code style={{ color: '#0284c7', fontWeight: 600 }}>{rawDevice}</code> &bull; Station: <span style={{ fontWeight: 600 }}>{vendorStationId || 'station-A'}</span> &bull; Updated: <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{lastPacketTime || 'Connecting...'}</span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setStreamActive(!streamActive)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                background: streamActive ? '#fef2f2' : '#f0fdf4',
                color: streamActive ? '#dc2626' : '#16a34a',
                border: `1px solid ${streamActive ? '#fecaca' : '#bbf7d0'}`,
                borderRadius: 6,
                padding: '0.45rem 0.8rem',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
              title={streamActive ? 'Pause auto-polling live stream to inspect current packet' : 'Resume live stream'}
            >
              {streamActive ? <Pause size={13} /> : <Play size={13} />}
              <span>{streamActive ? 'Pause Stream' : 'Resume Stream'}</span>
            </button>

            <button
              type="button"
              onClick={handleRefreshLiveStream}
              disabled={isRefreshingStream}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                background: '#f8fafc',
                color: '#0284c7',
                border: '1px solid #cbd5e1',
                borderRadius: 6,
                padding: '0.45rem 0.8rem',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              <RefreshCw size={13} className={isRefreshingStream ? 'animate-spin' : ''} />
              <span>{isRefreshingStream ? 'Querying...' : 'Poll Now'}</span>
            </button>

            <button
              type="button"
              onClick={() => handleCopy(JSON.stringify(liveStreamReading, null, 2), 'live-json')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                background: '#0284c7',
                color: '#ffffff',
                border: 'none',
                borderRadius: 6,
                padding: '0.45rem 0.85rem',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 2px 4px rgba(2, 132, 199, 0.25)',
              }}
            >
              {copiedKey === 'live-json' ? <Check size={13} /> : <Copy size={13} />}
              <span>{copiedKey === 'live-json' ? 'JSON Copied!' : 'Copy Live JSON'}</span>
            </button>
          </div>
        </div>

        {/* ============================================================ */}
        {/* LIVE HARDWARE COUNTERS & DISCOVERY STATUS BANNER             */}
        {/* ============================================================ */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
            gap: '0.85rem',
            marginBottom: '1.25rem',
          }}
        >
          {/* Card 1: How many devices coming */}
          <div
            style={{
              background: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)',
              border: '1px solid #86efac',
              borderRadius: 10,
              padding: '1rem',
              position: 'relative',
              overflow: 'hidden',
              boxShadow: '0 2px 4px rgba(22, 163, 74, 0.08)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#166534', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                INCOMING BLE DEVICES
              </span>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                  background: '#16a34a',
                  color: '#ffffff',
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  padding: '0.15rem 0.5rem',
                  borderRadius: 999,
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ffffff', display: 'inline-block' }} />
                <span>LIVE ACTIVE</span>
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem' }}>
              <span className="font-mono" style={{ fontSize: '1.9rem', fontWeight: 900, color: '#14532d' }}>
                <SmoothNumber value={totalDevicesComing} decimals={0} />
              </span>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#15803d' }}>
                Device{totalDevicesComing !== 1 ? 's' : ''} Detected
              </span>
            </div>
            <div style={{ fontSize: '0.72rem', color: '#166534', marginTop: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <Cpu size={13} color="#16a34a" />
              <span>
                {discoveredDevices.length} RF Sensor Nodes in latest live frame
              </span>
            </div>
          </div>

          {/* Card 2: How many BLE gateways */}
          <div
            style={{
              background: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
              border: '1px solid #93c5fd',
              borderRadius: 10,
              padding: '1rem',
              position: 'relative',
              overflow: 'hidden',
              boxShadow: '0 2px 4px rgba(2, 132, 199, 0.08)',
              transition: 'all 0.4s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#1e40af', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                BLE GATEWAYS CONNECTED
              </span>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                  background: '#2563eb',
                  color: '#ffffff',
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  padding: '0.15rem 0.5rem',
                  borderRadius: 999,
                }}
              >
                <Wifi size={10} />
                <span>ONLINE</span>
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem' }}>
              <span className="font-mono" style={{ fontSize: '1.9rem', fontWeight: 900, color: '#1e3a8a' }}>
                <SmoothNumber value={totalBleGateways} decimals={0} />
              </span>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1d4ed8' }}>
                BLE Gateway{totalBleGateways > 1 ? 's' : ''} Online
              </span>
            </div>
            <div style={{ fontSize: '0.72rem', color: '#1e40af', marginTop: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <HardDrive size={13} color="#2563eb" />
              <span>
                {gateways[0]?.id || 'gw-ble-01'} &bull; Ingestion Port 8000
              </span>
            </div>
          </div>

          {/* Card 3: Selected Device Filter Status */}
          <div
            style={{
              background: isAllSelected
                ? 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)'
                : 'linear-gradient(135deg, #fdf4ff 0%, #fae8ff 100%)',
              border: `1px solid ${isAllSelected ? '#cbd5e1' : '#f0abfc'}`,
              borderRadius: 10,
              padding: '1rem',
              position: 'relative',
              overflow: 'hidden',
              boxShadow: '0 2px 4px rgba(0,0,0,0.04)',
              transition: 'all 0.4s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 800, color: isAllSelected ? '#475569' : '#86198f', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                DEVICE FILTER SELECTION
              </span>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                  background: isAllSelected ? '#64748b' : isSingleSelected ? '#a21caf' : '#16a34a',
                  color: '#ffffff',
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  padding: '0.15rem 0.5rem',
                  borderRadius: 999,
                }}
              >
                <Filter size={10} />
                <span>
                  {isAllSelected
                    ? `ALL DEVICES (${discoveredDevices.length})`
                    : isSingleSelected
                    ? '1 DEVICE ISOLATED'
                    : `${selectedDeviceIds.length} DEVICES ACTIVE`}
                </span>
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span
                className="font-mono"
                style={{
                  fontSize: isAllSelected ? '1.3rem' : '1.15rem',
                  fontWeight: 800,
                  color: isAllSelected ? '#0f172a' : '#701a75',
                  transition: 'color 0.3s ease',
                }}
              >
                {isAllSelected
                  ? 'All Devices'
                  : isSingleSelected
                  ? selectedDeviceIds[0]
                  : `${selectedDeviceIds.length} Devices Selected`}
              </span>
              {!isAllSelected && (
                <button
                  type="button"
                  onClick={handleClearSelection}
                  style={{
                    background: '#ffffff',
                    border: '1px solid #e879f9',
                    borderRadius: 4,
                    padding: '0.15rem 0.4rem',
                    fontSize: '0.68rem',
                    color: '#a21caf',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                  title="Show all devices"
                >
                  Clear Selection ✕
                </button>
              )}
            </div>
            <div style={{ fontSize: '0.72rem', color: isAllSelected ? '#64748b' : '#86198f', marginTop: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <Eye size={13} color={isAllSelected ? '#64748b' : '#a21caf'} />
              <span>
                {isAllSelected
                  ? `Showing combined live feed across all ${discoveredDevices.length} nodes`
                  : isSingleSelected
                  ? `Isolated to ${selectedDeviceMeta?.name || selectedDeviceIds[0]}`
                  : `Comparative real-time matrix for ${selectedDeviceIds.slice(0, 3).join(', ')}${selectedDeviceIds.length > 3 ? '...' : ''}`}
              </span>
            </div>
          </div>

          {/* Card 4: API Sampling & Total Ingested */}
          <div
            style={{
              background: 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)',
              border: '1px solid #fde68a',
              borderRadius: 10,
              padding: '1rem',
              position: 'relative',
              overflow: 'hidden',
              boxShadow: '0 2px 4px rgba(217, 119, 6, 0.08)',
              transition: 'all 0.4s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#92400e', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                INGESTION PACKETS
              </span>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                  background: '#d97706',
                  color: '#ffffff',
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  padding: '0.15rem 0.5rem',
                  borderRadius: 999,
                }}
              >
                <Zap size={10} />
                <span>LIVE FEED</span>
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem' }}>
              <span className="font-mono" style={{ fontSize: '1.9rem', fontWeight: 900, color: '#78350f' }}>
                <SmoothNumber value={packetCount} decimals={0} />
              </span>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#b45309' }}>
                Packets / Latest Batch
              </span>
            </div>
            <div style={{ fontSize: '0.72rem', color: '#92400e', marginTop: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <Clock size={13} color="#d97706" />
              <span>
                Poll Interval: 1.0s &bull; Live Telemetry Frame &bull; Updated: {lastPacketTime || 'Live'}
              </span>
            </div>
          </div>
        </div>

        {/* ============================================================ */}
        {/* INTERACTIVE VISUAL DEVICE SELECTOR BAR                       */}
        {/* ============================================================ */}
        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #cbd5e1',
            borderRadius: 10,
            padding: '1rem 1.25rem',
            marginBottom: '1.25rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 6,
                  background: '#0284c7',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#ffffff',
                }}
              >
                <SlidersHorizontal size={16} />
              </div>
              <div>
                <span style={{ fontSize: '0.9rem', fontWeight: 800, color: '#0f172a' }}>
                  SELECT INCOMING DEVICE (CLICK TO FILTER ALL DATA VISUALLY)
                </span>
                <span style={{ fontSize: '0.75rem', color: '#64748b', display: 'block' }}>
                  Choose any incoming sensor device below to isolate and view ONLY that device's telemetry, metrics, charts, and raw payloads. Saved to database across browser refreshes.
                </span>
                {saveSelectionFeedback && (
                  <div
                    style={{
                      marginTop: '0.45rem',
                      padding: '0.3rem 0.65rem',
                      background: '#f0fdf4',
                      border: '1px solid #86efac',
                      borderRadius: 6,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      fontSize: '0.75rem',
                      color: '#15803d',
                      fontWeight: 700,
                    }}
                  >
                    <CheckCircle2 size={13} color="#16a34a" />
                    <span>{saveSelectionFeedback}</span>
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
              {/* Search filter for devices */}
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <Search size={12} color="#94a3b8" style={{ position: 'absolute', left: 8, pointerEvents: 'none' }} />
                <input
                  type="text"
                  placeholder="Filter MAC / Station..."
                  value={deviceSearchQuery}
                  onChange={(e) => setDeviceSearchQuery(e.target.value)}
                  style={{
                    padding: '0.28rem 0.5rem 0.28rem 1.6rem',
                    fontSize: '0.72rem',
                    border: '1px solid #cbd5e1',
                    borderRadius: 6,
                    background: '#ffffff',
                    width: 140,
                    outline: 'none',
                    color: '#0f172a',
                  }}
                />
                {deviceSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setDeviceSearchQuery('')}
                    style={{
                      position: 'absolute',
                      right: 4,
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      color: '#94a3b8',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    <X size={11} />
                  </button>
                )}
              </div>

              <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#64748b' }}>Selection:</span>
              <button
                type="button"
                onClick={handleSelectAllDevices}
                style={{
                  background: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: 6,
                  padding: '0.3rem 0.6rem',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  color: '#0284c7',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                }}
                title="Select all discovered BLE nodes"
              >
                <CheckCircle2 size={11} />
                <span>Select All ({discoveredDevices.length})</span>
              </button>

              {!isAllSelected && (
                <button
                  type="button"
                  onClick={handleClearSelection}
                  style={{
                    background: '#ffffff',
                    border: '1px solid #fca5a5',
                    borderRadius: 6,
                    padding: '0.3rem 0.6rem',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    color: '#dc2626',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                  }}
                  title="Clear all selected devices"
                >
                  <X size={11} />
                  <span>Clear ({selectedDeviceIds.length})</span>
                </button>
              )}

              {/* Save Selection to Database Button */}
              <button
                type="button"
                disabled={isSavingSelection}
                onClick={handleSaveSelectionToDb}
                style={{
                  background: isSelectionDirty ? '#0284c7' : '#ecfdf5',
                  border: isSelectionDirty ? '1px solid #0284c7' : '1px solid #a7f3d0',
                  borderRadius: 6,
                  padding: '0.3rem 0.65rem',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  color: isSelectionDirty ? '#ffffff' : '#065f46',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  transition: 'all 0.15s ease',
                  boxShadow: isSelectionDirty ? '0 1px 3px rgba(2, 132, 199, 0.3)' : 'none',
                }}
                title="Save current hardware filter into database so it persists across browser refreshes and filters all pages"
              >
                {isSavingSelection ? (
                  <>
                    <RefreshCw size={11} className="animate-spin" />
                    <span>Saving to DB...</span>
                  </>
                ) : (
                  <>
                    <Database size={11} />
                    <span>{isSelectionDirty ? 'Save Filter to DB' : 'Saved in DB'}</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Device Cards Grid with Multi-Select Support */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.75rem' }}>
            {/* Option 1: All Devices Chip */}
            <div
              onClick={() => handleToggleDevice('all')}
              style={{
                background: isAllSelected ? '#eff6ff' : '#ffffff',
                border: isAllSelected ? '2px solid #0284c7' : '1px solid #cbd5e1',
                borderRadius: 8,
                padding: '0.75rem 0.9rem',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                boxShadow: isAllSelected ? '0 0 0 3px rgba(2, 132, 199, 0.15)' : 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Layers size={16} color={isAllSelected ? '#0284c7' : '#64748b'} />
                  <span style={{ fontSize: '0.85rem', fontWeight: 800, color: isAllSelected ? '#0284c7' : '#1e293b' }}>
                    All Incoming Devices
                  </span>
                </div>
                {isAllSelected && (
                  <span
                    style={{
                      background: '#0284c7',
                      color: '#ffffff',
                      fontSize: '0.62rem',
                      fontWeight: 700,
                      padding: '0.1rem 0.45rem',
                      borderRadius: 4,
                    }}
                  >
                    ACTIVE (ALL)
                  </span>
                )}
              </div>
              <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.2rem' }}>
                Aggregate stream &bull; {discoveredDevices.length} real devices discovered
              </div>
            </div>

            {/* Individual Discovered Device Chips */}
            {searchedDevices.map((dev) => {
              const isSelected = selectedDeviceIds.includes(dev.device_id);
              return (
                <div
                  key={dev.device_id}
                  onClick={() => handleToggleDevice(dev.device_id)}
                  style={{
                    background: isSelected ? '#f0fdf4' : '#ffffff',
                    border: isSelected ? '2px solid #16a34a' : '1px solid #cbd5e1',
                    borderRadius: 8,
                    padding: '0.75rem 0.9rem',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    boxShadow: isSelected ? '0 0 0 3px rgba(22, 163, 74, 0.15)' : 'none',
                    position: 'relative',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                      {/* Visual Multi-select Checkbox indicator */}
                      <span
                        style={{
                          width: 15,
                          height: 15,
                          borderRadius: 3,
                          border: isSelected ? '2px solid #16a34a' : '1.5px solid #94a3b8',
                          background: isSelected ? '#16a34a' : '#ffffff',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#ffffff',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {isSelected && <Check size={11} strokeWidth={3} />}
                      </span>
                      <span className="font-mono" style={{ fontSize: '0.85rem', fontWeight: 800, color: isSelected ? '#15803d' : '#0f172a' }}>
                        {dev.device_id}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <span
                        style={{
                          background: '#f1f5f9',
                          color: '#475569',
                          fontSize: '0.65rem',
                          fontWeight: 700,
                          padding: '0.1rem 0.4rem',
                          borderRadius: 4,
                        }}
                      >
                        {dev.station_id}
                      </span>
                      {isSelected && (
                        <span
                          style={{
                            background: '#16a34a',
                            color: '#ffffff',
                            fontSize: '0.62rem',
                            fontWeight: 700,
                            padding: '0.1rem 0.45rem',
                            borderRadius: 4,
                          }}
                        >
                          SELECTED
                        </span>
                      )}
                    </div>
                  </div>

                  <div style={{ fontSize: '0.72rem', color: '#334155', fontWeight: 600, marginBottom: '0.35rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {dev.name}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.7rem', color: '#64748b' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                      <Signal size={11} color={dev.rssi > -70 ? '#16a34a' : '#d97706'} />
                      <strong>{dev.rssi} dBm</strong>
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                      <Battery size={11} color="#16a34a" />
                      <strong>{dev.battery_pct.toFixed(0)}%</strong>
                    </span>
                    <span style={{ fontFamily: 'monospace', color: '#0284c7', fontWeight: 700 }}>
                      {dev.packets_count} pkts
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ============================================================ */}
        {/* MULTI-DEVICE / VISUAL ISOLATION BANNER                      */}
        {/* ============================================================ */}
        {!isAllSelected && (
          <div
            style={{
              background: '#f0fdf4',
              border: '1px solid #86efac',
              borderRadius: 8,
              padding: '0.85rem 1.15rem',
              marginBottom: '1.25rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '0.75rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 6,
                  background: '#16a34a',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#ffffff',
                }}
              >
                <Eye size={18} />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#14532d' }}>
                    VISUAL FILTER ACTIVE &bull; {selectedDeviceIds.length} DEVICE{selectedDeviceIds.length > 1 ? 'S' : ''} SELECTED:
                  </span>
                  {selectedDeviceIds.map((id) => (
                    <span
                      key={id}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                        background: '#ffffff',
                        border: '1px solid #86efac',
                        padding: '0.15rem 0.45rem',
                        borderRadius: 4,
                        fontWeight: 800,
                        color: '#15803d',
                        fontFamily: 'monospace',
                        fontSize: '0.75rem',
                      }}
                    >
                      {id}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleDevice(id);
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          color: '#15803d',
                          padding: 0,
                          display: 'flex',
                          alignItems: 'center',
                        }}
                        title={`Remove ${id}`}
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#166534', marginTop: '0.2rem' }}>
                  All KPI metric tiles, raw API stream, and packets below show <strong>ONLY data for the {selectedDeviceIds.length} selected device{selectedDeviceIds.length > 1 ? 's' : ''}</strong> in real time.
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <button
                type="button"
                onClick={handleClearSelection}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  background: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: 6,
                  padding: '0.4rem 0.8rem',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  color: '#334155',
                  cursor: 'pointer',
                }}
              >
                <X size={13} />
                <span>Reset to All Devices</span>
              </button>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* MULTI-DEVICE COMPARATIVE LIVE TELEMETRY MATRIX GRID          */}
        {/* ============================================================ */}
        {isMultiSelected && (
          <div style={{ marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Activity size={15} color="#16a34a" />
                <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#15803d', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Multi-Device Comparative Telemetry Matrix ({selectedDeviceIds.length} Devices Active)
                </span>
              </div>
              <span style={{ fontSize: '0.7rem', color: '#64748b' }}>
                Simultaneous real-time acceleration, RMS vibration, and battery comparison
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: '0.75rem' }}>
              {selectedDeviceIds.map((devId) => {
                const devMeta = discoveredDevices.find((d) => d.device_id === devId);
                const devTelem = devicesTelemetryMap[devId] || {};
                const devRms = Number(devTelem.rms_g ?? devTelem.rms ?? devTelem.features?.rms ?? rawRms ?? 0);
                const devPeak = Number(devTelem.peak_g ?? devTelem.peak ?? devTelem.features?.peak ?? 0);
                const devX = Number(devTelem.acc_x_g ?? devTelem.x ?? devTelem.features?.acc_x ?? 0);
                const devY = Number(devTelem.acc_y_g ?? devTelem.y ?? devTelem.features?.acc_y ?? 0);
                const devZ = Number(devTelem.acc_z_g ?? devTelem.z ?? devTelem.features?.acc_z ?? 0);
                const devRssi = Number(devTelem.rssi ?? devMeta?.rssi ?? 0);
                const devBatt = Number(devTelem.battery_pct ?? devMeta?.battery_pct ?? 0);
                const devTemp = Number(devTelem.temperature ?? devMeta?.temperature ?? 0);

                return (
                  <div
                    key={devId}
                    style={{
                      background: '#ffffff',
                      border: '1px solid #bbf7d0',
                      borderRadius: 10,
                      padding: '0.85rem',
                      boxShadow: '0 2px 4px rgba(22, 163, 74, 0.06)',
                      transition: 'all 0.3s ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.4rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#16a34a', display: 'inline-block' }} />
                        <span className="font-mono" style={{ fontSize: '0.85rem', fontWeight: 800, color: '#0f172a' }}>
                          {devId}
                        </span>
                      </div>
                      <span
                        style={{
                          background: '#f0fdf4',
                          border: '1px solid #bbf7d0',
                          color: '#15803d',
                          fontSize: '0.65rem',
                          fontWeight: 700,
                          padding: '0.1rem 0.4rem',
                          borderRadius: 4,
                        }}
                      >
                        {devMeta?.station_id || 'station-A'}
                      </span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
                      <div style={{ background: '#f8fafc', padding: '0.45rem 0.6rem', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                        <div style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 600 }}>RMS VIBRATION</div>
                        <div className="font-mono" style={{ fontSize: '1.1rem', fontWeight: 800, color: devRms > 0.7 ? '#dc2626' : devRms > 0.35 ? '#d97706' : '#0284c7' }}>
                          <SmoothNumber value={devRms} decimals={4} /> <span style={{ fontSize: '0.68rem', color: '#64748b' }}>g</span>
                        </div>
                        <div style={{ fontSize: '0.65rem', color: '#64748b' }}>
                          Peak: <SmoothNumber value={devPeak} decimals={4} suffix=" g" />
                        </div>
                      </div>

                      <div style={{ background: '#f8fafc', padding: '0.45rem 0.6rem', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                        <div style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 600 }}>TRI-AXIAL (X, Y, Z)</div>
                        <div className="font-mono" style={{ fontSize: '0.72rem', color: '#334155', marginTop: '0.15rem' }}>
                          X: <strong><SmoothNumber value={devX} decimals={3} /></strong> g
                        </div>
                        <div className="font-mono" style={{ fontSize: '0.72rem', color: '#334155' }}>
                          Y: <strong><SmoothNumber value={devY} decimals={3} /></strong> g
                        </div>
                        <div className="font-mono" style={{ fontSize: '0.72rem', color: '#334155' }}>
                          Z: <strong><SmoothNumber value={devZ} decimals={3} /></strong> g
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.7rem', color: '#475569', background: '#f1f5f9', padding: '0.35rem 0.6rem', borderRadius: 6 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <Signal size={12} color={devRssi > -70 ? '#16a34a' : '#d97706'} />
                        <strong>{devRssi} dBm</strong>
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <Battery size={12} color="#16a34a" />
                        <strong>{devBatt.toFixed(0)}%</strong> ({Math.round((devBatt / 100) * 3300)} mV)
                      </span>
                      <span>
                        🌡️ <strong>{devTemp.toFixed(1)}°C</strong>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Real-time KPI Metric Tiles (Live telemetry from API) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
          {/* Tile 1: Vibration RMS & Peak */}
          <div style={{ background: '#f8fafc', padding: '0.75rem', borderRadius: 8, border: '1px solid #e2e8f0', transition: 'all 0.4s ease', boxShadow: isPacketFlash ? '0 0 10px rgba(2, 132, 199, 0.2)' : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>TRIAXIAL VIBRATION RMS</span>
              <span style={{ fontSize: '0.68rem', color: rawRms > 0.70 ? '#dc2626' : rawRms > 0.35 ? '#d97706' : '#16a34a', fontWeight: 700, transition: 'color 0.3s ease' }}>
                {rawRms > 0.70 ? 'CRITICAL' : rawRms > 0.35 ? 'ELEVATED' : 'NOMINAL'}
              </span>
            </div>
            <div className="font-mono" style={{ fontSize: '1.35rem', fontWeight: 800, color: '#0284c7', marginTop: 3 }}>
              <SmoothNumber value={rawRms} decimals={4} /> <span style={{ fontSize: '0.75rem', fontWeight: 500, color: '#64748b' }}>g</span>
            </div>
            <div style={{ fontSize: '0.72rem', color: '#475569', marginTop: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Peak: <strong><SmoothNumber value={rawPeak} decimals={4} suffix=" g" /></strong></span>
              <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '0.1rem 0.35rem', borderRadius: 3, fontFamily: 'monospace', fontSize: '0.68rem', fontWeight: 700 }}>
                {displayDevice}
              </span>
            </div>
          </div>

          {/* Tile 2: Triaxial X/Y/Z Acceleration */}
          <div style={{ background: '#f8fafc', padding: '0.75rem', borderRadius: 8, border: '1px solid #e2e8f0', transition: 'all 0.4s ease' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>ACCELEROMETER (X, Y, Z)</span>
              <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '0.1rem 0.35rem', borderRadius: 3, fontFamily: 'monospace', fontSize: '0.68rem', fontWeight: 700 }}>
                {displayDevice}
              </span>
            </div>
            <div className="font-mono" style={{ fontSize: '0.85rem', fontWeight: 700, color: '#0f172a', marginTop: 6, display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>X-axis:</span>
                <span style={{ color: '#0284c7' }}><SmoothNumber value={rawX} decimals={4} prefix={rawX >= 0 ? '+' : ''} suffix=" g" /></span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Y-axis:</span>
                <span style={{ color: '#0284c7' }}><SmoothNumber value={rawY} decimals={4} prefix={rawY >= 0 ? '+' : ''} suffix=" g" /></span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Z-axis (Gravity):</span>
                <span style={{ color: '#0f172a' }}><SmoothNumber value={rawZ} decimals={4} prefix={rawZ >= 0 ? '+' : ''} suffix=" g" /></span>
              </div>
            </div>
          </div>

          {/* Tile 3: Spindle Motor Speed */}
          <div style={{ background: '#f8fafc', padding: '0.75rem', borderRadius: 8, border: '1px solid #e2e8f0', transition: 'all 0.4s ease' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>TACHOMETER &amp; SPINDLE</span>
              <span
                style={{
                  background: rawMotorStatus === 'RUNNING' ? '#dcfce7' : rawMotorStatus === 'SLOW' ? '#fef3c7' : '#fee2e2',
                  color: rawMotorStatus === 'RUNNING' ? '#15803d' : rawMotorStatus === 'SLOW' ? '#b45309' : '#b91c1c',
                  padding: '0.1rem 0.4rem',
                  borderRadius: 4,
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  transition: 'all 0.3s ease',
                }}
              >
                {rawMotorStatus}
              </span>
            </div>
            <div className="font-mono" style={{ fontSize: '1.35rem', fontWeight: 800, color: '#0f172a', marginTop: 3 }}>
              <SmoothNumber value={rawRpm} decimals={0} /> <span style={{ fontSize: '0.75rem', fontWeight: 500, color: '#64748b' }}>RPM</span>
            </div>
            <div style={{ fontSize: '0.72rem', color: '#475569', marginTop: 3, display: 'flex', justifyContent: 'space-between' }}>
              <span>Command: <strong><SmoothNumber value={rawSpeedPct} decimals={0} suffix="%" /></strong></span>
              <span style={{ color: '#64748b' }}>Kurtosis: <strong><SmoothNumber value={rawKurt} decimals={2} /></strong></span>
            </div>
          </div>

          {/* Tile 4: AI Safety Guardian State */}
          <div style={{ background: '#f8fafc', padding: '0.75rem', borderRadius: 8, border: '1px solid #e2e8f0', transition: 'all 0.4s ease' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>SAFETY INTERLOCK STATE</span>
              <span
                style={{
                  background: rawState === 'NORMAL' ? '#dcfce7' : rawState === 'REDUCED_SPEED' ? '#fef3c7' : '#fee2e2',
                  color: rawState === 'NORMAL' ? '#15803d' : rawState === 'REDUCED_SPEED' ? '#b45309' : '#b91c1c',
                  padding: '0.1rem 0.4rem',
                  borderRadius: 4,
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  transition: 'all 0.3s ease',
                }}
              >
                {rawState}
              </span>
            </div>
            <div className="font-mono" style={{ fontSize: '1.35rem', fontWeight: 800, color: rawLight === 'RED' ? '#dc2626' : rawLight === 'AMBER' ? '#d97706' : '#16a34a', marginTop: 3, transition: 'color 0.3s ease' }}>
              <SmoothNumber value={rawScore} decimals={3} /> <span style={{ fontSize: '0.75rem', fontWeight: 500, color: '#64748b' }}>score</span>
            </div>
            <div style={{ fontSize: '0.72rem', color: '#475569', marginTop: 3 }}>
              Light: <strong style={{ color: rawLight === 'RED' ? '#dc2626' : rawLight === 'AMBER' ? '#d97706' : '#16a34a', transition: 'color 0.3s ease' }}>{rawLight}</strong> &bull; Packets: <strong><SmoothNumber value={packetCount} decimals={0} /></strong>
            </div>
          </div>

          {/* Tile 5: Hardware Power & Temp */}
          <div style={{ background: '#f8fafc', padding: '0.75rem', borderRadius: 8, border: '1px solid #e2e8f0', transition: 'all 0.4s ease' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>SENSOR NODE POWER &amp; RF</span>
              <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '0.1rem 0.35rem', borderRadius: 3, fontFamily: 'monospace', fontSize: '0.68rem', fontWeight: 700 }}>
                {displayDevice}
              </span>
            </div>
            <div className="font-mono" style={{ fontSize: '1.35rem', fontWeight: 800, color: '#0f172a', marginTop: 3 }}>
              <SmoothNumber value={displayBattMv} decimals={0} /> <span style={{ fontSize: '0.75rem', fontWeight: 500, color: '#64748b' }}>mV</span>
            </div>
            <div style={{ fontSize: '0.72rem', color: '#475569', marginTop: 3, display: 'flex', justifyContent: 'space-between' }}>
              <span>Battery: <strong style={{ color: '#16a34a' }}><SmoothNumber value={displayBatt} decimals={1} suffix="%" /></strong></span>
              <span>Temp: <strong><SmoothNumber value={displayTemp} decimals={1} suffix="°C" /></strong></span>
              <span>RSSI: <strong><SmoothNumber value={displayRssi} decimals={0} suffix="dBm" /></strong></span>
            </div>
          </div>
        </div>

        {/* View Switcher Tabs (JSON / KPI Table / Packet Feed) */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ display: 'flex', gap: '0.4rem', background: '#f1f5f9', padding: '0.25rem', borderRadius: 8 }}>
            <button
              type="button"
              onClick={() => setStreamTab('json')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                border: 'none',
                background: streamTab === 'json' ? '#ffffff' : 'transparent',
                color: streamTab === 'json' ? '#0f172a' : '#64748b',
                fontWeight: 700,
                fontSize: '0.75rem',
                padding: '0.35rem 0.75rem',
                borderRadius: 6,
                cursor: 'pointer',
                boxShadow: streamTab === 'json' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
              }}
            >
              <Terminal size={14} color={streamTab === 'json' ? '#0284c7' : '#64748b'} />
              <span>Live API JSON Payload (Raw Data)</span>
            </button>

            <button
              type="button"
              onClick={() => setStreamTab('kpis')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                border: 'none',
                background: streamTab === 'kpis' ? '#ffffff' : 'transparent',
                color: streamTab === 'kpis' ? '#0f172a' : '#64748b',
                fontWeight: 700,
                fontSize: '0.75rem',
                padding: '0.35rem 0.75rem',
                borderRadius: 6,
                cursor: 'pointer',
                boxShadow: streamTab === 'kpis' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
              }}
            >
              <Gauge size={14} color={streamTab === 'kpis' ? '#0284c7' : '#64748b'} />
              <span>Telemetry Key-Value Table</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setStreamTab('history');
                fetchHistoryPackets(selectedDeviceIds);
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                border: 'none',
                background: streamTab === 'history' ? '#ffffff' : 'transparent',
                color: streamTab === 'history' ? '#0f172a' : '#64748b',
                fontWeight: 700,
                fontSize: '0.75rem',
                padding: '0.35rem 0.75rem',
                borderRadius: 6,
                cursor: 'pointer',
                boxShadow: streamTab === 'history' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
              }}
            >
              <Clock size={14} color={streamTab === 'history' ? '#0284c7' : '#64748b'} />
              <span>
                Incoming Packets Feed ({filteredPackets.length})
                {!isAllSelected && ` [${selectedDeviceIds.length} Filtered]`}
              </span>
            </button>
          </div>

          <div style={{ fontSize: '0.72rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
            <span>Telemetry Endpoints:</span>
            <code style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '0.15rem 0.45rem', borderRadius: 4, color: '#16a34a', fontWeight: 600 }}>
              GET /api/v1/gateway/ble/telemetry/latest{!isAllSelected ? `?device_id=${encodeURIComponent(selectedDeviceIds.join(','))}` : ''}
            </code>
            <code style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '0.15rem 0.45rem', borderRadius: 4, color: '#0284c7', fontWeight: 600 }}>
              GET /api/v1/gateway/ble/devices
            </code>
          </div>
        </div>

        {/* TAB 1: Real-Time Live API JSON Inspector */}
        {streamTab === 'json' && (
          <div
            style={{
              background: '#0a0f1d',
              border: `1px solid ${isPacketFlash ? '#38bdf8' : '#1e293b'}`,
              borderRadius: 8,
              padding: '1rem',
              color: '#f8fafc',
              fontFamily: 'monospace',
              fontSize: '0.8rem',
              transition: 'border 0.2s',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem', paddingBottom: '0.5rem', borderBottom: '1px solid #1e293b', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ color: '#4ade80', fontWeight: 700 }}>✓ Incoming API Packet (Live Stream)</span>
                <span style={{ color: '#64748b' }}>&bull;</span>
                <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>
                  Target: <strong style={{ color: '#38bdf8' }}>{displayDevice}</strong>
                </span>
                {!isAllSelected && (
                  <span style={{ background: '#0284c7', color: '#ffffff', fontSize: '0.65rem', padding: '0.1rem 0.35rem', borderRadius: 3, fontWeight: 700 }}>
                    {selectedDeviceIds.length} SELECTED
                  </span>
                )}
                <span style={{ color: '#64748b' }}>&bull;</span>
                <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>
                  Timestamp: <span style={{ color: '#cbd5e1' }}>{rawTimestamp}</span>
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.72rem' }}>
                <span style={{ color: '#94a3b8' }}>
                  Fields Detected: <strong style={{ color: '#facc15' }}>{liveStreamReading ? Object.keys(liveStreamReading).length : 0} keys</strong>
                </span>
                <span style={{ color: isPacketFlash ? '#22c55e' : '#64748b', fontWeight: 600 }}>
                  {isPacketFlash ? '● Packet Ingested' : 'Waiting for next packet...'}
                </span>
              </div>
            </div>

            <pre
              style={{
                margin: 0,
                padding: '0.75rem',
                background: '#040711',
                borderRadius: 6,
                color: '#38bdf8',
                fontSize: '0.76rem',
                overflowX: 'auto',
                maxHeight: '340px',
                lineHeight: 1.45,
              }}
            >
              {liveStreamReading
                ? JSON.stringify(
                    isMultiSelected && Object.keys(devicesTelemetryMap).length > 0
                      ? {
                          active_stream_packet: liveStreamReading,
                          selected_device_ids: selectedDeviceIds,
                          devices_telemetry: devicesTelemetryMap,
                        }
                      : liveStreamReading,
                    null,
                    2
                  )
                : '{\n  "status": "CONNECTING",\n  "message": "Querying live packet from remote host..."\n}'}
            </pre>
          </div>
        )}

        {/* TAB 2: Parsed Telemetry KPI Key-Value Table */}
        {streamTab === 'kpis' && (
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '0.72rem', textTransform: 'uppercase' }}>
                  <th style={{ padding: '0.6rem 0.85rem' }}>Parameter / Telemetry Field</th>
                  <th style={{ padding: '0.6rem 0.85rem' }}>Data Type</th>
                  <th style={{ padding: '0.6rem 0.85rem' }}>Live Value (Incoming)</th>
                  <th style={{ padding: '0.6rem 0.85rem' }}>Engineering Unit</th>
                  <th style={{ padding: '0.6rem 0.85rem' }}>Status / Description</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom: '1px solid #f1f5f9', background: '#f0fdf4' }}>
                  <td style={{ padding: '0.55rem 0.85rem', fontWeight: 700, color: '#166534' }}>device_id / Sensor MAC</td>
                  <td style={{ padding: '0.55rem 0.85rem', fontFamily: 'monospace', color: '#64748b' }}>String (MAC)</td>
                  <td style={{ padding: '0.55rem 0.85rem', fontWeight: 800, color: '#15803d', fontFamily: 'monospace' }}>{displayDevice}</td>
                  <td style={{ padding: '0.55rem 0.85rem', color: '#64748b' }}>EUI-48</td>
                  <td style={{ padding: '0.55rem 0.85rem', color: '#15803d', fontWeight: 600 }}>{selectedDeviceMeta?.name || 'Selected Sensor Node'}</td>
                </tr>
                <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '0.55rem 0.85rem', fontWeight: 600, color: '#0f172a' }}>rms_g (Triaxial Vibration RMS)</td>
                  <td style={{ padding: '0.55rem 0.85rem', fontFamily: 'monospace', color: '#64748b' }}>Float (g)</td>
                  <td style={{ padding: '0.55rem 0.85rem', fontWeight: 700, color: '#0284c7', fontFamily: 'monospace' }}>{rawRms.toFixed(4)}</td>
                  <td style={{ padding: '0.55rem 0.85rem', color: '#64748b' }}>g (Acceleration)</td>
                  <td style={{ padding: '0.55rem 0.85rem', color: rawRms < 0.35 ? '#16a34a' : '#d97706', fontWeight: 600 }}>{rawRms < 0.35 ? 'Nominal Baseline (<0.35g)' : 'Elevated Energy'}</td>
                </tr>
                <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '0.55rem 0.85rem', fontWeight: 600, color: '#0f172a' }}>peak_g (Dynamic Peak Acceleration)</td>
                  <td style={{ padding: '0.55rem 0.85rem', fontFamily: 'monospace', color: '#64748b' }}>Float (g)</td>
                  <td style={{ padding: '0.55rem 0.85rem', fontWeight: 700, color: '#0f172a', fontFamily: 'monospace' }}>{rawPeak.toFixed(4)}</td>
                  <td style={{ padding: '0.55rem 0.85rem', color: '#64748b' }}>g (Peak)</td>
                  <td style={{ padding: '0.55rem 0.85rem', color: '#64748b' }}>Crest factor: {rawCrest.toFixed(2)}</td>
                </tr>
                <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '0.55rem 0.85rem', fontWeight: 600, color: '#0f172a' }}>acc_x_g, acc_y_g, acc_z_g</td>
                  <td style={{ padding: '0.55rem 0.85rem', fontFamily: 'monospace', color: '#64748b' }}>Triaxial Tuple</td>
                  <td style={{ padding: '0.55rem 0.85rem', fontFamily: 'monospace', color: '#0284c7' }}>[{rawX.toFixed(4)}, {rawY.toFixed(4)}, {rawZ.toFixed(4)}]</td>
                  <td style={{ padding: '0.55rem 0.85rem', color: '#64748b' }}>g</td>
                  <td style={{ padding: '0.55rem 0.85rem', color: '#64748b' }}>MEMS triaxial acceleration vectors</td>
                </tr>
                <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '0.55rem 0.85rem', fontWeight: 600, color: '#0f172a' }}>measured_rpm (Spindle Tachometer)</td>
                  <td style={{ padding: '0.55rem 0.85rem', fontFamily: 'monospace', color: '#64748b' }}>Float (RPM)</td>
                  <td style={{ padding: '0.55rem 0.85rem', fontWeight: 700, color: '#0f172a', fontFamily: 'monospace' }}>{rawRpm.toFixed(1)}</td>
                  <td style={{ padding: '0.55rem 0.85rem', color: '#64748b' }}>RPM</td>
                  <td style={{ padding: '0.55rem 0.85rem', color: rawMotorStatus === 'RUNNING' ? '#16a34a' : '#d97706', fontWeight: 600 }}>Motor is {rawMotorStatus}</td>
                </tr>
                <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '0.55rem 0.85rem', fontWeight: 600, color: '#0f172a' }}>state &amp; commanded_speed_pct</td>
                  <td style={{ padding: '0.55rem 0.85rem', fontFamily: 'monospace', color: '#64748b' }}>Actuation State</td>
                  <td style={{ padding: '0.55rem 0.85rem', fontWeight: 700, color: rawLight === 'RED' ? '#dc2626' : rawLight === 'AMBER' ? '#d97706' : '#16a34a' }}>{rawState} ({rawSpeedPct}%)</td>
                  <td style={{ padding: '0.55rem 0.85rem', color: '#64748b' }}>Percentage %</td>
                  <td style={{ padding: '0.55rem 0.85rem', color: '#64748b' }}>Indicator Light: <strong>{rawLight}</strong></td>
                </tr>
                <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '0.55rem 0.85rem', fontWeight: 600, color: '#0f172a' }}>anomaly_score (AI Model Prediction)</td>
                  <td style={{ padding: '0.55rem 0.85rem', fontFamily: 'monospace', color: '#64748b' }}>Float (0.0 - 1.0)</td>
                  <td style={{ padding: '0.55rem 0.85rem', fontWeight: 700, color: rawScore >= 0.70 ? '#dc2626' : rawScore >= 0.45 ? '#d97706' : '#16a34a', fontFamily: 'monospace' }}>{rawScore.toFixed(4)}</td>
                  <td style={{ padding: '0.55rem 0.85rem', color: '#64748b' }}>Score Ratio</td>
                  <td style={{ padding: '0.55rem 0.85rem', color: '#64748b' }}>Warn Threshold: 0.45 &bull; Critical: 0.70</td>
                </tr>
                <tr>
                  <td style={{ padding: '0.55rem 0.85rem', fontWeight: 600, color: '#0f172a' }}>vbatt &amp; temp (Node Battery &amp; Temp)</td>
                  <td style={{ padding: '0.55rem 0.85rem', fontFamily: 'monospace', color: '#64748b' }}>Sensor Health</td>
                  <td style={{ padding: '0.55rem 0.85rem', fontFamily: 'monospace', color: '#0f172a' }}>{displayBattMv} mV / {displayTemp.toFixed(1)} °C</td>
                  <td style={{ padding: '0.55rem 0.85rem', color: '#64748b' }}>mV / °C</td>
                  <td style={{ padding: '0.55rem 0.85rem', color: '#16a34a', fontWeight: 600 }}>Battery ({displayBatt.toFixed(1)}%) &bull; Signal: {displayRssi} dBm</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* TAB 3: Chronological Incoming Packet Feed */}
        {streamTab === 'history' && (
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ background: '#f8fafc', padding: '0.6rem 0.9rem', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.75rem', color: '#475569' }}>
              <div>
                Showing <strong>{filteredPackets.length}</strong> packets
                {!isAllSelected ? (
                  <span> matching selected device(s): <strong style={{ color: '#0284c7' }}>{selectedDeviceIds.join(', ')}</strong></span>
                ) : (
                  <span> across all detected devices</span>
                )}
              </div>
              {!isAllSelected && (
                <button
                  type="button"
                  onClick={handleClearSelection}
                  style={{
                    background: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: 4,
                    padding: '0.2rem 0.5rem',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    color: '#0284c7',
                    cursor: 'pointer',
                  }}
                >
                  Show All Packets ({recentPackets.length})
                </button>
              )}
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '0.72rem', textTransform: 'uppercase' }}>
                  <th style={{ padding: '0.6rem 0.85rem' }}>Packet ID</th>
                  <th style={{ padding: '0.6rem 0.85rem' }}>Timestamp</th>
                  <th style={{ padding: '0.6rem 0.85rem' }}>Source</th>
                  <th style={{ padding: '0.6rem 0.85rem' }}>Device MAC</th>
                  <th style={{ padding: '0.6rem 0.85rem' }}>RMS (g)</th>
                  <th style={{ padding: '0.6rem 0.85rem' }}>Speed (RPM)</th>
                  <th style={{ padding: '0.6rem 0.85rem' }}>State</th>
                  <th style={{ padding: '0.6rem 0.85rem' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredPackets.map((pkt, idx) => {
                  const pDev = pkt.device_id || (pkt.payload && (pkt.payload.device_id || pkt.payload.dmac)) || rawDevice;
                  const isMatching = !isAllSelected && selectedDeviceIds.includes(pDev);
                  return (
                    <tr
                      key={pkt.id || idx}
                      className="smooth-row-entry"
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        background: isMatching ? '#f0fdf4' : idx === 0 ? '#f8fafc' : '#ffffff',
                        transition: 'background-color 0.4s ease',
                      }}
                    >
                      <td style={{ padding: '0.55rem 0.85rem', fontFamily: 'monospace', fontWeight: 700, color: '#0284c7' }}>
                        {pkt.id || `#${idx + 1}`}
                      </td>
                      <td style={{ padding: '0.55rem 0.85rem', fontFamily: 'monospace', color: '#64748b' }}>
                        {pkt.timestamp}
                      </td>
                      <td style={{ padding: '0.55rem 0.85rem', color: '#334155', fontSize: '0.75rem' }}>
                        {pkt.source || 'Live Feed'}
                      </td>
                      <td style={{ padding: '0.55rem 0.85rem', fontFamily: 'monospace', color: '#0f172a', fontWeight: 700 }}>
                        {pDev}
                      </td>
                      <td style={{ padding: '0.55rem 0.85rem', fontFamily: 'monospace', fontWeight: 700, color: '#0284c7' }}>
                        {Number(pkt.rms ?? rawRms).toFixed(4)} g
                      </td>
                      <td style={{ padding: '0.55rem 0.85rem', fontFamily: 'monospace', color: '#0f172a' }}>
                        {Number(pkt.rpm ?? rawRpm).toFixed(0)} RPM
                      </td>
                      <td style={{ padding: '0.55rem 0.85rem' }}>
                        <span
                          style={{
                            background: (pkt.state || rawState) === 'NORMAL' ? '#dcfce7' : '#fef3c7',
                            color: (pkt.state || rawState) === 'NORMAL' ? '#15803d' : '#b45309',
                            padding: '0.1rem 0.4rem',
                            borderRadius: 4,
                            fontSize: '0.7rem',
                            fontWeight: 700,
                          }}
                        >
                          {pkt.state || rawState}
                        </span>
                      </td>
                      <td style={{ padding: '0.55rem 0.85rem' }}>
                        <button
                          type="button"
                          onClick={() => {
                            setLiveStreamReading(pkt.payload || pkt);
                            setStreamTab('json');
                          }}
                          style={{
                            background: '#f1f5f9',
                            border: '1px solid #cbd5e1',
                            borderRadius: 4,
                            padding: '0.2rem 0.5rem',
                            fontSize: '0.7rem',
                            fontWeight: 600,
                            color: '#0284c7',
                            cursor: 'pointer',
                          }}
                        >
                          Inspect JSON
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {filteredPackets.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                      <div style={{ fontWeight: 600 }}>
                        Awaiting incoming live telemetry packets from API host URL for device(s): <code>{selectedDeviceIds.join(', ') || 'All'}</code>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Active Gateways Telemetry Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem' }}>
        {gateways.map((gw) => (
          <div
            key={gw.id}
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 10,
              padding: '1.25rem',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Wifi size={18} color="#0284c7" />
                  <span style={{ fontWeight: 700, fontSize: '1rem', color: '#0f172a' }}>{gw.name}</span>
                </div>
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.2rem' }}>
                  ID: <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{gw.id}</span>
                </div>
              </div>

              <div
                style={{
                  background: gw.status === 'online' ? '#dcfce7' : '#fee2e2',
                  color: gw.status === 'online' ? '#15803d' : '#b91c1c',
                  border: `1px solid ${gw.status === 'online' ? '#86efac' : '#fca5a5'}`,
                  borderRadius: 999,
                  padding: '0.2rem 0.6rem',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                ● {gw.status}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.8rem' }}>
              <div style={{ background: '#f8fafc', padding: '0.6rem', borderRadius: 6 }}>
                <div style={{ color: '#64748b', fontSize: '0.7rem' }}>Gateway MAC / IP</div>
                <div style={{ fontWeight: 600, color: '#1e293b', fontFamily: 'monospace' }}>
                  {gw.mac_address}
                </div>
                <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{gw.ip_address}</div>
              </div>

              <div style={{ background: '#f8fafc', padding: '0.6rem', borderRadius: 6 }}>
                <div style={{ color: '#64748b', fontSize: '0.7rem' }}>Target Station</div>
                <div style={{ fontWeight: 700, color: '#0284c7' }}>{gw.station_id}</div>
                <div style={{ fontSize: '0.7rem', color: '#64748b' }}>Angle Nutrunner</div>
              </div>

              <div style={{ background: '#f8fafc', padding: '0.6rem', borderRadius: 6 }}>
                <div style={{ color: '#64748b', fontSize: '0.7rem' }}>Packets Streamed</div>
                <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '1.05rem', fontFamily: 'monospace' }}>
                  {gw.packets_received.toLocaleString()}
                </div>
                <div style={{ fontSize: '0.7rem', color: '#10b981' }}>0 Dropped (100% Delivery)</div>
              </div>

              <div style={{ background: '#f8fafc', padding: '0.6rem', borderRadius: 6 }}>
                <div style={{ color: '#64748b', fontSize: '0.7rem' }}>RSSI & Battery</div>
                <div style={{ fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <span>{gw.avg_rssi} dBm</span>
                  <span style={{ color: '#cbd5e1' }}>&bull;</span>
                  <span style={{ color: '#10b981' }}>{gw.battery_pct}%</span>
                </div>
                <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                  Firmware: {gw.firmware_version}
                </div>
              </div>
            </div>

            <div
              style={{
                marginTop: '1rem',
                paddingTop: '0.75rem',
                borderTop: '1px solid #f1f5f9',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: '0.75rem',
                color: '#64748b',
              }}
            >
              <span>Last Heartbeat: {new Date(gw.last_seen).toLocaleTimeString()}</span>
              <span style={{ fontFamily: 'monospace', color: '#0284c7', fontWeight: 600 }}>
                {gw.api_endpoint}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Developer API Documentation & Snippets */}
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          padding: '1.5rem',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Terminal size={20} color="#0284c7" />
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>
              Hardware Integration Code & API Specification
            </h3>
          </div>

          <div style={{ display: 'flex', gap: '0.4rem', background: '#f1f5f9', padding: '0.25rem', borderRadius: 8 }}>
            <button
              onClick={() => setActiveCodeTab('curl')}
              style={{
                border: 'none',
                background: activeCodeTab === 'curl' ? '#ffffff' : 'transparent',
                color: activeCodeTab === 'curl' ? '#0f172a' : '#64748b',
                fontWeight: 700,
                fontSize: '0.75rem',
                padding: '0.35rem 0.75rem',
                borderRadius: 6,
                cursor: 'pointer',
                boxShadow: activeCodeTab === 'curl' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
              }}
            >
              cURL (Bash)
            </button>
            <button
              onClick={() => setActiveCodeTab('python')}
              style={{
                border: 'none',
                background: activeCodeTab === 'python' ? '#ffffff' : 'transparent',
                color: activeCodeTab === 'python' ? '#0f172a' : '#64748b',
                fontWeight: 700,
                fontSize: '0.75rem',
                padding: '0.35rem 0.75rem',
                borderRadius: 6,
                cursor: 'pointer',
                boxShadow: activeCodeTab === 'python' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
              }}
            >
              Python Client
            </button>
            <button
              onClick={() => setActiveCodeTab('esp32')}
              style={{
                border: 'none',
                background: activeCodeTab === 'esp32' ? '#ffffff' : 'transparent',
                color: activeCodeTab === 'esp32' ? '#0f172a' : '#64748b',
                fontWeight: 700,
                fontSize: '0.75rem',
                padding: '0.35rem 0.75rem',
                borderRadius: 6,
                cursor: 'pointer',
                boxShadow: activeCodeTab === 'esp32' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
              }}
            >
              ESP32 / Arduino C++
            </button>
            <button
              onClick={() => setActiveCodeTab('schema')}
              style={{
                border: 'none',
                background: activeCodeTab === 'schema' ? '#ffffff' : 'transparent',
                color: activeCodeTab === 'schema' ? '#0f172a' : '#64748b',
                fontWeight: 700,
                fontSize: '0.75rem',
                padding: '0.35rem 0.75rem',
                borderRadius: 6,
                cursor: 'pointer',
                boxShadow: activeCodeTab === 'schema' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
              }}
            >
              JSON Contract
            </button>
          </div>
        </div>

        {/* Code Content Container */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => {
              const text =
                activeCodeTab === 'curl'
                  ? docs?.sample_curl || ''
                  : activeCodeTab === 'python'
                    ? docs?.sample_python || ''
                    : activeCodeTab === 'esp32'
                      ? esp32Code
                      : jsonSchema;
              handleCopy(text, activeCodeTab);
            }}
            style={{
              position: 'absolute',
              top: '0.75rem',
              right: '0.75rem',
              background: '#334155',
              border: '1px solid #475569',
              borderRadius: 6,
              color: '#f8fafc',
              padding: '0.35rem 0.65rem',
              fontSize: '0.75rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              cursor: 'pointer',
              zIndex: 10,
            }}
          >
            {copiedKey === activeCodeTab ? <Check size={14} color="#4ade80" /> : <Copy size={14} />}
            <span>{copiedKey === activeCodeTab ? 'Copied!' : 'Copy Code'}</span>
          </button>

          <pre
            style={{
              background: '#0f172a',
              color: '#e2e8f0',
              padding: '1.25rem',
              borderRadius: 8,
              fontSize: '0.8rem',
              overflowX: 'auto',
              fontFamily: 'monospace',
              margin: 0,
              lineHeight: 1.5,
              maxHeight: '420px',
            }}
          >
            {activeCodeTab === 'curl' && (docs?.sample_curl || 'Loading cURL command...')}
            {activeCodeTab === 'python' && (docs?.sample_python || 'Loading Python script...')}
            {activeCodeTab === 'esp32' && esp32Code}
            {activeCodeTab === 'schema' && jsonSchema}
          </pre>
        </div>

        <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: '#64748b' }}>
          <ShieldCheck size={16} color="#10b981" />
          <span>
            API Authentication: Standard Bearer Token or Gateway Key header (<code>X-Gateway-Key: ble-key-spindle-01-prod</code>).
          </span>
        </div>
      </div>
    </div>
  );
};
