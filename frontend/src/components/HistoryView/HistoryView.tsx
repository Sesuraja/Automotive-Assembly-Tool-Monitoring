import React, { useState, useEffect } from 'react';
import { api } from '../../services/api';
import {
  History,
  Download,
  RefreshCw,
  Search,
  Activity,
  Cpu,
  ShieldAlert,
  FileText,
  Clock,
} from 'lucide-react';
import { exportToProfessionalPdf } from '../../utils/exportPdf';
import { useAppSettings } from '../../context/AppSettingsContext';

export const HistoryView: React.FC = () => {
  const { settings, formatDateTime } = useAppSettings();
  const [activeTab, setActiveTab] = useState<'features' | 'scores' | 'decisions'>('features');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [limit, setLimit] = useState<number>(50);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [isLiveStreaming, setIsLiveStreaming] = useState<boolean>(true);
  const [systemTime, setSystemTime] = useState<string>(formatDateTime(new Date()));

  // Real-time live clock ticker formatted according to dynamic timezone
  useEffect(() => {
    const clockInterval = setInterval(() => {
      setSystemTime(formatDateTime(new Date()));
    }, 1000);
    return () => clearInterval(clockInterval);
  }, [formatDateTime]);

  const fetchData = async () => {
    try {
      if (activeTab === 'features') {
        const res = await api.getFeaturesHistory(limit);
        if (Array.isArray(res)) setData(res);
      } else if (activeTab === 'scores') {
        const res = await api.getScoresHistory(limit);
        if (Array.isArray(res)) setData(res);
      } else {
        const res = await api.getDecisionsHistory(limit);
        if (Array.isArray(res)) setData(res);
      }
    } catch (e) {
      console.error('Failed to query history archive', e);
    }
  };

  useEffect(() => {
    setLoading(true);
    fetchData().finally(() => setLoading(false));
  }, [activeTab, limit]);

  // Live Auto-Stream Poller
  useEffect(() => {
    let interval: any = null;
    if (isLiveStreaming) {
      interval = setInterval(fetchData, 1500);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isLiveStreaming, activeTab, limit]);

  // Filtering
  const filteredData = data.filter((item) => {
    if (!searchTerm) return true;
    const str = JSON.stringify(item).toLowerCase();
    return str.includes(searchTerm.toLowerCase());
  });

  // Calculate high-yield live summary metrics dynamically - NO HARDCODING
  const hasFeatureData = activeTab === 'features' && data.length > 0;
  const avgRms = hasFeatureData
    ? (data.reduce((acc, d) => acc + (d.rms ?? 0), 0) / data.length).toFixed(3)
    : data.length > 0 && data[0].rms !== undefined
    ? (data.reduce((acc, d) => acc + (d.rms ?? 0), 0) / data.length).toFixed(3)
    : '0.000';

  const maxPeak = hasFeatureData
    ? Math.max(...data.map((d) => d.peak ?? 0)).toFixed(3)
    : data.length > 0 && data[0].peak !== undefined
    ? Math.max(...data.map((d) => d.peak ?? 0)).toFixed(3)
    : '0.000';

  const avgAnomaly =
    data.length > 0
      ? (
          data.reduce((acc, d) => acc + (d.smoothed_anomaly_score ?? d.smoothed_score ?? d.score ?? 0), 0) /
          data.length
        ).toFixed(3)
      : '0.000';

  const tripsCount = data.filter(
    (d) => d.state === 'STOPPED' || d.state === 'REDUCED_SPEED' || d.event_type === 'TRIP'
  ).length;

  // Dynamic CSV Export
  const handleExportCsv = () => {
    if (filteredData.length === 0) return;
    let headers: string[] = [];
    let rows: string[][] = [];

    if (activeTab === 'features') {
      headers = ['Timestamp', 'Station', 'Seq', 'RMS_g', 'Peak_g', 'DominantFreq_Hz', 'Kurtosis', 'RPM', 'Amps'];
      rows = filteredData.map((d) => [
        `"${formatDateTime(d.ts)}"`,
        `"${d.station_id || settings.stationId}"`,
        `"${d.seq ?? ''}"`,
        `"${d.rms?.toFixed(4) ?? ''}"`,
        `"${d.peak?.toFixed(4) ?? ''}"`,
        `"${d.dominant_freq?.toFixed(2) ?? ''}"`,
        `"${d.kurtosis?.toFixed(2) ?? ''}"`,
        `"${d.measured_rpm?.toFixed(1) ?? ''}"`,
        `"${d.current_amps?.toFixed(2) ?? ''}"`,
      ]);
    } else if (activeTab === 'scores') {
      headers = ['Timestamp', 'Station', 'ModelVersion', 'RawScore', 'SmoothedEWMA', 'Persistence', 'State', 'BeaconLight'];
      rows = filteredData.map((d) => [
        `"${formatDateTime(d.ts)}"`,
        `"${d.station_id || settings.stationId}"`,
        `"${d.model_version || ''}"`,
        `"${d.raw_anomaly_score?.toFixed(4) ?? d.raw_score?.toFixed(4) ?? ''}"`,
        `"${(d.smoothed_anomaly_score ?? d.smoothed_score ?? 0).toFixed(4)}"`,
        `"${d.persistence_counter ?? 0}"`,
        `"${d.state || 'NORMAL'}"`,
        `"${d.indicator_light || 'GREEN'}"`,
      ]);
    } else {
      headers = ['Timestamp', 'Station', 'State', 'BeaconLight', 'CommandedSpeedPct', 'LayerCaused', 'Reason'];
      rows = filteredData.map((d) => [
        `"${formatDateTime(d.ts)}"`,
        `"${d.station_id || settings.stationId}"`,
        `"${d.state || ''}"`,
        `"${d.indicator_light || ''}"`,
        `"${d.commanded_speed_pct ?? 100}"`,
        `"${d.layer_caused || ''}"`,
        `"${(d.reason || d.last_decision_reason || '').replace(/"/g, '""')}"`,
      ]);
    }

    const csvContent =
      'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute('href', encodeURI(csvContent));
    const safeBrand = (settings.brandName || 'station').toLowerCase().replace(/[^a-z0-9]/g, '_');
    dlAnchor.setAttribute('download', `${safeBrand}_history_${activeTab}_${Date.now()}.csv`);
    dlAnchor.click();
  };

  // Professional PDF Export
  const handleExportPdf = () => {
    let title = `${settings.brandName} Historical Vibration Telemetry Archive`;
    let subtitle = `${settings.companyName} • Synchronous feature vectors, spectral analysis, and physical metrics (Timezone: ${settings.timezone})`;
    let columns: string[] = [];
    let rows: (string | number)[][] = [];

    if (activeTab === 'features') {
      title = `${settings.brandName} Historical Vibration Features Report`;
      columns = ['Timestamp', 'Station', 'Seq #', 'RMS (g)', 'Peak (g)', 'Dominant Freq', 'Kurtosis', 'RPM', 'Current'];
      rows = filteredData.map((d) => [
        formatDateTime(d.ts),
        d.station_id || settings.stationId,
        `#${d.seq ?? 0}`,
        d.rms?.toFixed(4) ?? '0.000',
        d.peak?.toFixed(4) ?? '0.000',
        d.dominant_freq ? `${d.dominant_freq.toFixed(1)} Hz` : '—',
        d.kurtosis?.toFixed(2) ?? '—',
        d.measured_rpm ? `${d.measured_rpm.toFixed(0)} RPM` : '—',
        d.current_amps ? `${d.current_amps.toFixed(2)} A` : '—',
      ]);
    } else if (activeTab === 'scores') {
      title = `${settings.brandName} Anomaly Scoring & Inference Archive`;
      subtitle = `${settings.companyName} • ML model inferences, smoothed EWMA, and anomaly thresholds (Timezone: ${settings.timezone})`;
      columns = ['Timestamp', 'Station', 'Model Version', 'Raw Score', 'Smoothed EWMA', 'Persistence', 'Classification', 'Light'];
      rows = filteredData.map((d) => {
        const score = d.smoothed_anomaly_score ?? d.smoothed_score ?? 0;
        return [
          formatDateTime(d.ts),
          d.station_id || settings.stationId,
          d.model_version || 'v1.0.0-baseline',
          (d.raw_anomaly_score ?? d.raw_score ?? 0).toFixed(3),
          score.toFixed(3),
          `${d.persistence_counter ?? 0} win`,
          d.state || 'NORMAL',
          d.indicator_light || 'GREEN',
        ];
      });
    } else {
      title = `${settings.brandName} Safety Decision & Closed-Loop Actuation Archive`;
      subtitle = `${settings.companyName} • Intervention triggers, speed reduction actions, and engineering rationale (Timezone: ${settings.timezone})`;
      columns = ['Timestamp', 'Station', 'State', 'Beacon Light', 'Commanded Speed', 'Layer Caused', 'Engineering Rationale'];
      rows = filteredData.map((d) => [
        formatDateTime(d.ts),
        d.station_id || settings.stationId,
        d.state?.replace('_', ' ') || 'NORMAL',
        d.indicator_light || 'GREEN',
        `${d.commanded_speed_pct ?? 100}%`,
        d.layer_caused || 'NOMINAL',
        d.reason || d.last_decision_reason || 'Nominal operation.',
      ]);
    }

    exportToProfessionalPdf({
      title,
      subtitle,
      systemTime,
      kpis: [
        { label: 'Archived Points', value: filteredData.length.toString(), unit: 'RECORDS', accent: 'blue' },
        { label: 'Window Mean RMS', value: avgRms, unit: 'g', accent: 'green' },
        { label: 'Peak Vibration Max', value: maxPeak, unit: 'g', accent: 'amber' },
        { label: 'Interventions / Trips', value: tripsCount.toString(), unit: 'EVENTS', accent: 'red' },
      ],
      columns,
      rows,
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Top Real-Time KPI Ribbon with System Clock */}
      <div className="metrics-ribbon">
        <div className="metric-tile blue">
          <div className="metric-label">Archived Telemetry Points</div>
          <div className="metric-value-row">
            <span className="metric-value font-mono">{data.length}</span>
            <span className="metric-unit">RECORDS</span>
          </div>
          <div className="metric-footer">Synchronous Ingestion Archive</div>
        </div>

        <div className="metric-tile green">
          <div className="metric-label">Window Mean RMS</div>
          <div className="metric-value-row">
            <span className="metric-value font-mono">{avgRms}</span>
            <span className="metric-unit">g</span>
          </div>
          <div className="metric-footer">Calculated over current live query</div>
        </div>

        <div className="metric-tile amber">
          <div className="metric-label">Peak Vibration Max</div>
          <div className="metric-value-row">
            <span className="metric-value font-mono">{maxPeak}</span>
            <span className="metric-unit">g</span>
          </div>
          <div className="metric-footer">ISO 10816 Limit: 1.250 g</div>
        </div>

        <div className="metric-tile red">
          <div className="metric-label">Intervention / Trip Events</div>
          <div className="metric-value-row">
            <span className="metric-value font-mono">{tripsCount}</span>
            <span className="metric-unit">EVENTS</span>
          </div>
          <div className="metric-footer">
            Trips & Slowdowns &bull; Mean Anomaly: {avgAnomaly}
          </div>
        </div>
      </div>

      {/* Main Historical Table Card */}
      <div className="b2b-card">
        {/* Card Header & Controls */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '1rem',
            borderBottom: '1px solid var(--border-color)',
            paddingBottom: '1rem',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <History size={18} color="#0284c7" />
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>
                Historical Telemetry & Audit Archives
              </h2>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                fontSize: '0.8rem',
                color: 'var(--text-muted)',
                marginTop: 4,
              }}
            >
              <span>Partitioned database archive of feature vectors, inference scores, and closed-loop actuation states</span>
              <span style={{ color: '#cbd5e1' }}>&bull;</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', color: '#0284c7', fontWeight: 600 }}>
                <Clock size={13} />
                <span>System Clock: {systemTime} ({settings.timezone})</span>
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            {/* Live Streaming Toggle */}
            <button
              onClick={() => setIsLiveStreaming(!isLiveStreaming)}
              className="jog-btn"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                fontSize: '0.8rem',
                fontWeight: 600,
                background: isLiveStreaming ? '#ecfdf5' : '#f8fafc',
                borderColor: isLiveStreaming ? '#a7f3d0' : 'var(--border-color)',
                color: isLiveStreaming ? '#065f46' : 'var(--text-muted)',
              }}
              title="Toggle automatic 1.5s real-time streaming"
            >
              <span className={`motor-pulse-dot ${isLiveStreaming ? 'green' : 'amber'}`}></span>
              <span>{isLiveStreaming ? 'LIVE STREAMING (1.5s)' : 'STREAM PAUSED'}</span>
            </button>

            {/* Manual Refresh */}
            <button
              onClick={fetchData}
              disabled={loading}
              className="jog-btn"
              style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem' }}
              title="Fetch latest entries immediately"
            >
              <RefreshCw size={14} className={loading ? 'spin-smooth' : ''} />
              <span>Refresh</span>
            </button>

            {/* CSV Export */}
            <button
              onClick={handleExportCsv}
              className="jog-btn"
              style={{
                padding: '0.45rem 0.85rem',
                borderRadius: 6,
                background: '#f8fafc',
                borderColor: '#cbd5e1',
                color: '#334155',
                fontSize: '0.8rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                cursor: 'pointer',
              }}
              title="Export filtered records to CSV"
            >
              <Download size={14} color="#0284c7" />
              <span>Export CSV</span>
            </button>

            {/* PDF Export */}
            <button
              onClick={handleExportPdf}
              style={{
                padding: '0.45rem 0.95rem',
                borderRadius: 6,
                background: '#0284c7',
                border: 'none',
                color: '#ffffff',
                fontSize: '0.8rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                cursor: 'pointer',
                boxShadow: '0 1px 2px rgba(2, 132, 199, 0.2)',
              }}
              title={`Export official ${settings.brandName} branded PDF report`}
            >
              <FileText size={14} />
              <span>Export PDF ({settings.brandName})</span>
            </button>
          </div>
        </div>

        {/* Tab Switcher & Filter Controls */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.75rem',
            marginTop: '1rem',
            borderBottom: '1px solid var(--border-color)',
            paddingBottom: '0.75rem',
          }}
        >
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <button
              onClick={() => setActiveTab('features')}
              className={`filter-pill ${activeTab === 'features' ? 'active' : ''}`}
            >
              <Activity size={13} style={{ display: 'inline', marginRight: 4 }} />
              Vibration Features ({activeTab === 'features' ? filteredData.length : '—'})
            </button>
            <button
              onClick={() => setActiveTab('scores')}
              className={`filter-pill ${activeTab === 'scores' ? 'active' : ''}`}
            >
              <Cpu size={13} style={{ display: 'inline', marginRight: 4 }} />
              Anomaly Scores ({activeTab === 'scores' ? filteredData.length : '—'})
            </button>
            <button
              onClick={() => setActiveTab('decisions')}
              className={`filter-pill ${activeTab === 'decisions' ? 'active' : ''}`}
            >
              <ShieldAlert size={13} style={{ display: 'inline', marginRight: 4 }} />
              Decision Events ({activeTab === 'decisions' ? filteredData.length : '—'})
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            {/* Search Box */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                background: '#f8fafc',
                border: '1px solid var(--border-color)',
                borderRadius: 6,
                padding: '0.35rem 0.65rem',
                width: '220px',
              }}
            >
              <Search size={14} color="#94a3b8" />
              <input
                type="text"
                placeholder="Filter entries..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  outline: 'none',
                  fontSize: '0.8rem',
                  width: '100%',
                  color: 'var(--text-main)',
                }}
              />
            </div>

            {/* Limit Selector */}
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              style={{
                padding: '0.35rem 0.65rem',
                borderRadius: 6,
                border: '1px solid var(--border-color)',
                background: '#fff',
                fontSize: '0.8rem',
                color: 'var(--text-main)',
                outline: 'none',
              }}
            >
              <option value={25}>Show 25</option>
              <option value={50}>Show 50</option>
              <option value={100}>Show 100</option>
              <option value={200}>Show 200</option>
            </select>
          </div>
        </div>

        {/* Dynamic Telemetry Table */}
        <div style={{ overflowX: 'auto', marginTop: '0.75rem' }}>
          {activeTab === 'features' && (
            <table className="b2b-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Station</th>
                  <th>Seq #</th>
                  <th>RMS (g)</th>
                  <th>Peak (g)</th>
                  <th>Dominant Freq</th>
                  <th>Kurtosis</th>
                  <th>Tachometer</th>
                  <th>Phase Current</th>
                </tr>
              </thead>
              <tbody>
                {filteredData.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                      No feature telemetry recorded yet.
                    </td>
                  </tr>
                ) : (
                  filteredData.map((row, i) => (
                    <tr key={row.id ?? i}>
                      <td className="font-mono" style={{ fontSize: '0.75rem', color: '#64748b' }}>
                        {formatDateTime(row.ts)}
                      </td>
                      <td style={{ fontWeight: 600 }}>{row.station_id || settings.stationId}</td>
                      <td className="font-mono" style={{ color: '#0284c7' }}>
                        #{row.seq}
                      </td>
                      <td
                        className="font-mono"
                        style={{ fontWeight: 700, color: row.rms > 0.8 ? '#d97706' : '#059669' }}
                      >
                        {row.rms !== undefined && row.rms !== null ? row.rms.toFixed(4) : '—'}
                      </td>
                      <td className="font-mono">
                        {row.peak !== undefined && row.peak !== null ? row.peak.toFixed(4) : '—'}
                      </td>
                      <td className="font-mono" style={{ color: '#0284c7' }}>
                        {row.dominant_freq !== undefined && row.dominant_freq !== null
                          ? `${row.dominant_freq.toFixed(1)} Hz`
                          : '—'}
                      </td>
                      <td className="font-mono">
                        {row.kurtosis !== undefined && row.kurtosis !== null ? row.kurtosis.toFixed(2) : '—'}
                      </td>
                      <td className="font-mono" style={{ fontWeight: 600 }}>
                        {row.measured_rpm !== undefined && row.measured_rpm !== null
                          ? `${row.measured_rpm.toFixed(0)} RPM`
                          : '—'}
                      </td>
                      <td className="font-mono" style={{ color: '#475569' }}>
                        {row.current_amps !== undefined && row.current_amps !== null
                          ? `${row.current_amps.toFixed(2)} A`
                          : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {activeTab === 'scores' && (
            <table className="b2b-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Station</th>
                  <th>Model Version</th>
                  <th>Raw Score</th>
                  <th>Smoothed EWMA</th>
                  <th>Persistence</th>
                  <th>State Classification</th>
                  <th>Beacon Light</th>
                </tr>
              </thead>
              <tbody>
                {filteredData.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                      No anomaly scoring logs recorded yet.
                    </td>
                  </tr>
                ) : (
                  filteredData.map((row, i) => {
                    const score = row.smoothed_anomaly_score ?? row.smoothed_score ?? row.score ?? 0.0;
                    const isWarn = score >= (row.warn_threshold ?? 0.45);
                    const isCrit = score >= (row.critical_threshold ?? 0.7);
                    return (
                      <tr key={row.id ?? i}>
                        <td className="font-mono" style={{ fontSize: '0.75rem', color: '#64748b' }}>
                          {formatDateTime(row.ts)}
                        </td>
                        <td style={{ fontWeight: 600 }}>{row.station_id || settings.stationId}</td>
                        <td className="font-mono" style={{ fontSize: '0.75rem' }}>
                          {row.model_version || 'v1.0.0-baseline'}
                        </td>
                        <td className="font-mono">
                          {(row.raw_anomaly_score ?? row.raw_score ?? 0).toFixed(3)}
                        </td>
                        <td
                          className="font-mono"
                          style={{
                            fontWeight: 700,
                            color: isCrit ? '#dc2626' : isWarn ? '#d97706' : '#059669',
                          }}
                        >
                          {score.toFixed(3)}
                        </td>
                        <td className="font-mono">{row.persistence_counter ?? 0} windows</td>
                        <td>
                          <span
                            style={{
                              padding: '0.2rem 0.55rem',
                              borderRadius: 4,
                              fontSize: '0.75rem',
                              fontWeight: 700,
                              background: isCrit ? '#fef2f2' : isWarn ? '#fffbeb' : '#ecfdf5',
                              color: isCrit ? '#991b1b' : isWarn ? '#92400e' : '#065f46',
                              border: `1px solid ${isCrit ? '#fecaca' : isWarn ? '#fde68a' : '#a7f3d0'}`,
                            }}
                          >
                            {isCrit ? 'CRITICAL FAULT' : isWarn ? 'WARNING DISTURBANCE' : 'NOMINAL'}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`status-dot ${isCrit ? 'offline' : 'online'}`}
                            style={{ background: isCrit ? '#ef4444' : isWarn ? '#f59e0b' : '#10b981' }}
                          ></span>
                          <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>
                            {isCrit ? 'RED' : isWarn ? 'AMBER' : 'GREEN'}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}

          {activeTab === 'decisions' && (
            <table className="b2b-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Station</th>
                  <th>Control State</th>
                  <th>Beacon Light</th>
                  <th>Commanded Speed</th>
                  <th>Triggering Layer</th>
                  <th>Engineering Rationale</th>
                </tr>
              </thead>
              <tbody>
                {filteredData.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                      No decision events recorded yet.
                    </td>
                  </tr>
                ) : (
                  filteredData.map((row, i) => (
                    <tr key={row.id ?? i}>
                      <td className="font-mono" style={{ fontSize: '0.75rem', color: '#64748b' }}>
                        {formatDateTime(row.ts)}
                      </td>
                      <td style={{ fontWeight: 600 }}>{row.station_id || settings.stationId}</td>
                      <td>
                        <span
                          style={{
                            padding: '0.2rem 0.6rem',
                            borderRadius: 4,
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            background:
                              row.state === 'STOPPED'
                                ? '#fef2f2'
                                : row.state === 'REDUCED_SPEED'
                                ? '#fffbeb'
                                : '#ecfdf5',
                            color:
                              row.state === 'STOPPED'
                                ? '#991b1b'
                                : row.state === 'REDUCED_SPEED'
                                ? '#92400e'
                                : '#065f46',
                            border: `1px solid ${
                              row.state === 'STOPPED'
                                ? '#fecaca'
                                : row.state === 'REDUCED_SPEED'
                                ? '#fde68a'
                                : '#a7f3d0'
                            }`,
                          }}
                        >
                          {row.state?.replace('_', ' ') || 'NORMAL'}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700 }}>
                          {row.indicator_light || 'GREEN'}
                        </span>
                      </td>
                      <td className="font-mono" style={{ fontWeight: 700 }}>
                        {row.commanded_speed_pct !== undefined ? `${row.commanded_speed_pct.toFixed(0)}%` : '100%'}
                      </td>
                      <td>
                        <span
                          className="font-mono"
                          style={{ fontSize: '0.75rem', background: '#f1f5f9', padding: '0.15rem 0.45rem', borderRadius: 4 }}
                        >
                          {row.layer_caused || 'NOMINAL'}
                        </span>
                      </td>
                      <td style={{ fontSize: '0.8rem', color: '#334155' }}>
                        {row.reason || row.last_decision_reason || 'Nominal operation within limits.'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
