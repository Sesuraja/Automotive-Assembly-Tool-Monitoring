import React, { useState, useEffect } from 'react';
import type { RecordingItem } from '../../types';
import { api } from '../../services/api';
import {
  Database,
  Search,
  Filter,
  Download,
  Trash2,
  Eye,
  PlusCircle,
  Square,
  RefreshCw,
  X,
  CheckCircle2,
  AlertTriangle,
  Edit3,
  Save,
  Activity,
  ShieldCheck,
  Cpu,
  ChevronLeft,
  ChevronRight,
  Plus,
} from 'lucide-react';

interface RecordingsViewProps {
  recordings: RecordingItem[];
}

type TabType = 'features' | 'decisions' | 'scores' | 'recordings';

export const RecordingsView: React.FC<RecordingsViewProps> = ({ recordings: initialRecordings }) => {
  const [activeTab, setActiveTab] = useState<TabType>('features');

  // --- TAB 1: RECORDINGS (DATASETS) STATE ---
  const [recordings, setRecordings] = useState<RecordingItem[]>(initialRecordings);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [filterLabel, setFilterLabel] = useState<'all' | 'normal' | 'disturbed'>('all');
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [inspectItem, setInspectItem] = useState<any | null>(null);
  const [isLoadingInspect, setIsLoadingInspect] = useState<boolean>(false);

  // Edit Recording Session Modal
  const [editRecModal, setEditRecModal] = useState<RecordingItem | null>(null);
  const [editRecName, setEditRecName] = useState<string>('');
  const [editRecLabel, setEditRecLabel] = useState<string>('normal');
  const [isSavingRec, setIsSavingRec] = useState<boolean>(false);

  // Direct Live Recording state
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [activeLabel, setActiveLabel] = useState<'normal' | 'disturbed'>('normal');
  const [recElapsed, setRecElapsed] = useState<number>(0);

  // --- DATABASE OVERVIEW STATS ---
  const [dbOverview, setDbOverview] = useState<any | null>(null);

  // --- TAB 2: FEATURES TABLE STATE ---
  const [featureRows, setFeatureRows] = useState<any[]>([]);
  const [featuresTotal, setFeaturesTotal] = useState<number>(0);
  const featuresLimit = 25;
  const [featuresPage, setFeaturesPage] = useState<number>(0);
  const [featuresSearch, setFeaturesSearch] = useState<string>('');
  const [isLoadingFeatures, setIsLoadingFeatures] = useState<boolean>(false);

  // Edit Feature Modal
  const [editFeatModal, setEditFeatModal] = useState<any | null>(null);
  const [featRms, setFeatRms] = useState<number>(0.0);
  const [featPeak, setFeatPeak] = useState<number>(0.0);
  const [featKurt, setFeatKurt] = useState<number>(2.8);
  const [featFreq, setFeatFreq] = useState<number>(50.0);

  // Create Feature Modal
  const [createFeatModal, setCreateFeatModal] = useState<boolean>(false);
  const [newFeatRms, setNewFeatRms] = useState<number>(0.25);
  const [newFeatPeak, setNewFeatPeak] = useState<number>(0.55);
  const [newFeatFreq, setNewFeatFreq] = useState<number>(60.0);

  // --- TAB 3: DECISIONS TABLE STATE ---
  const [decisionRows, setDecisionRows] = useState<any[]>([]);
  const [decisionsTotal, setDecisionsTotal] = useState<number>(0);
  const [decisionsPage, setDecisionsPage] = useState<number>(0);
  const [decisionStateFilter, setDecisionStateFilter] = useState<string>('ALL');
  const [isLoadingDecisions, setIsLoadingDecisions] = useState<boolean>(false);

  // Edit Decision Modal
  const [editDecModal, setEditDecModal] = useState<any | null>(null);
  const [decState, setDecState] = useState<string>('NORMAL');
  const [decReason, setDecReason] = useState<string>('');
  const [decSpeed, setDecSpeed] = useState<number>(100.0);
  const [decLight, setDecLight] = useState<string>('GREEN');

  // --- TAB 4: ANOMALY SCORES TABLE STATE ---
  const [scoreRows, setScoreRows] = useState<any[]>([]);
  const [scoresTotal, setScoresTotal] = useState<number>(0);
  const [scoresPage, setScoresPage] = useState<number>(0);
  const [isLoadingScores, setIsLoadingScores] = useState<boolean>(false);

  // Fetch Database Overview
  const fetchDbOverview = async () => {
    try {
      const data = await api.getDatabaseOverview();
      setDbOverview(data);
    } catch (e) {
      console.error('[DB Overview Error]', e);
    }
  };

  // Refresh dataset recordings
  const refreshRecordings = async () => {
    try {
      const data = await api.listRecordings();
      if (Array.isArray(data)) {
        setRecordings(data);
      }
    } catch (e) {
      console.error('Failed to refresh recordings', e);
    }
  };

  // Fetch Features Table
  const fetchFeatures = async () => {
    setIsLoadingFeatures(true);
    try {
      const res = await api.getDatabaseFeatures(featuresLimit, featuresPage * featuresLimit, featuresSearch);
      if (res && Array.isArray(res.data)) {
        setFeatureRows(res.data);
        setFeaturesTotal(res.total || 0);
      }
    } catch (e) {
      console.error('[Fetch Features Error]', e);
    } finally {
      setIsLoadingFeatures(false);
    }
  };

  // Fetch Decisions Table
  const fetchDecisions = async () => {
    setIsLoadingDecisions(true);
    try {
      const res = await api.getDatabaseDecisions(25, decisionsPage * 25, decisionStateFilter);
      if (res && Array.isArray(res.data)) {
        setDecisionRows(res.data);
        setDecisionsTotal(res.total || 0);
      }
    } catch (e) {
      console.error('[Fetch Decisions Error]', e);
    } finally {
      setIsLoadingDecisions(false);
    }
  };

  // Fetch Scores Table
  const fetchScores = async () => {
    setIsLoadingScores(true);
    try {
      const res = await api.getDatabaseAnomalyScores(25, scoresPage * 25);
      if (res && Array.isArray(res.data)) {
        setScoreRows(res.data);
        setScoresTotal(res.total || 0);
      }
    } catch (e) {
      console.error('[Fetch Scores Error]', e);
    } finally {
      setIsLoadingScores(false);
    }
  };

  useEffect(() => {
    setRecordings(initialRecordings);
  }, [initialRecordings]);

  useEffect(() => {
    refreshRecordings();
    fetchDbOverview();
    if (activeTab === 'features') fetchFeatures();
    if (activeTab === 'decisions') fetchDecisions();
    if (activeTab === 'scores') fetchScores();
    const interval = setInterval(() => {
      refreshRecordings();
      fetchDbOverview();
      if (activeTab === 'features') fetchFeatures();
      if (activeTab === 'decisions') fetchDecisions();
      if (activeTab === 'scores') fetchScores();
    }, 3000);
    return () => clearInterval(interval);
  }, [activeTab, featuresPage, featuresLimit, featuresSearch, decisionsPage, decisionStateFilter, scoresPage]);

  // Handle Tab Switch
  const handleTabChange = (t: TabType) => {
    setActiveTab(t);
    if (t === 'features') fetchFeatures();
    if (t === 'decisions') fetchDecisions();
    if (t === 'scores') fetchScores();
  };

  // Live recording timer
  useEffect(() => {
    let timer: any = null;
    if (isRecording) {
      timer = setInterval(() => setRecElapsed((prev) => prev + 1), 1000);
    } else {
      setRecElapsed(0);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isRecording]);

  const handleStartCapture = async (label: 'normal' | 'disturbed') => {
    try {
      setActiveLabel(label);
      setIsRecording(true);
      const sessionName = `${label === 'normal' ? 'Baseline Normal' : 'Resonance Fault'} Session (${new Date().toLocaleTimeString()})`;
      await api.startRecording(label, sessionName);
    } catch (e) {
      console.error(e);
      setIsRecording(false);
    }
  };

  const handleStopCapture = async () => {
    try {
      const sessionName = `${activeLabel === 'normal' ? 'Baseline Normal' : 'Resonance Fault'} Session (${new Date().toLocaleTimeString()})`;
      await api.stopRecording(sessionName);
      setIsRecording(false);
      await refreshRecordings();
      await fetchDbOverview();
    } catch (e) {
      console.error(e);
      setIsRecording(false);
    }
  };

  const handleInspect = async (recId: string) => {
    setIsLoadingInspect(true);
    try {
      const details = await api.getRecording(recId);
      setInspectItem(details);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingInspect(false);
    }
  };

  const handleDeleteRecording = async (recId: string) => {
    if (!window.confirm(`Delete recording session "${recId}" from database?`)) return;
    try {
      await api.deleteRecording(recId);
      await refreshRecordings();
      await fetchDbOverview();
      if (inspectItem?.id === recId) setInspectItem(null);
    } catch (e) {
      console.error(e);
    }
  };

  // Open Edit Modal for Recording
  const openEditRecording = (r: RecordingItem) => {
    setEditRecModal(r);
    setEditRecName(r.name);
    setEditRecLabel(r.label);
  };

  // Save Edited Recording
  const handleSaveRecording = async () => {
    if (!editRecModal) return;
    setIsSavingRec(true);
    try {
      await api.updateRecording(editRecModal.id, {
        name: editRecName,
        label: editRecLabel,
      });
      await refreshRecordings();
      setEditRecModal(null);
    } catch (e) {
      alert('Failed to update recording: ' + e);
    } finally {
      setIsSavingRec(false);
    }
  };

  // Feature Edit Handlers
  const openEditFeature = (f: any) => {
    setEditFeatModal(f);
    setFeatRms(f.rms);
    setFeatPeak(f.peak);
    setFeatKurt(f.kurtosis || 2.8);
    setFeatFreq(f.dominant_freq || 50.0);
  };

  const handleSaveFeature = async () => {
    if (!editFeatModal) return;
    try {
      await api.updateDatabaseFeature(editFeatModal.id, {
        rms: featRms,
        peak: featPeak,
        kurtosis: featKurt,
        dominant_freq: featFreq,
      });
      await fetchFeatures();
      setEditFeatModal(null);
    } catch (e) {
      alert('Failed to update feature: ' + e);
    }
  };

  const handleDeleteFeature = async (id: number) => {
    if (!window.confirm(`Delete feature row #${id} from database?`)) return;
    try {
      await api.deleteDatabaseFeature(id);
      await fetchFeatures();
      await fetchDbOverview();
    } catch (e) {
      console.error(e);
    }
  };

  const handleCreateFeature = async () => {
    try {
      await api.createDatabaseFeature({
        rms: newFeatRms,
        peak: newFeatPeak,
        dominant_freq: newFeatFreq,
      });
      await fetchFeatures();
      await fetchDbOverview();
      setCreateFeatModal(false);
    } catch (e) {
      alert('Failed to insert feature: ' + e);
    }
  };

  // Decision Edit Handlers
  const openEditDecision = (d: any) => {
    setEditDecModal(d);
    setDecState(d.state);
    setDecReason(d.reason);
    setDecSpeed(d.commanded_speed_pct);
    setDecLight(d.indicator_light || 'GREEN');
  };

  const handleSaveDecision = async () => {
    if (!editDecModal) return;
    try {
      await api.updateDatabaseDecision(editDecModal.id, {
        state: decState,
        reason: decReason,
        commanded_speed_pct: decSpeed,
        indicator_light: decLight,
      });
      await fetchDecisions();
      setEditDecModal(null);
    } catch (e) {
      alert('Failed to update decision: ' + e);
    }
  };

  const handleDeleteDecision = async (id: number) => {
    if (!window.confirm(`Delete decision row #${id} from database?`)) return;
    try {
      await api.deleteDatabaseDecision(id);
      await fetchDecisions();
      await fetchDbOverview();
    } catch (e) {
      console.error(e);
    }
  };

  const handleExportJson = (data: any, filename: string) => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(data, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute('href', dataStr);
    dlAnchor.setAttribute('download', `${filename}.json`);
    dlAnchor.click();
  };

  // Filtered recordings list
  const filteredRecordings = recordings.filter((r) => {
    const matchesSearch =
      r.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.file_path.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterLabel === 'all' || r.label === filterLabel;
    return matchesSearch && matchesFilter;
  });

  const totalWindows = recordings.reduce((acc, r) => acc + (r.sample_count || 0), 0);
  const normalCount = recordings.filter((r) => r.label === 'normal').length;
  const disturbedCount = recordings.filter((r) => r.label === 'disturbed').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* ========================================================================= */}
      {/* TOP REAL-TIME DATABASE KPI RIBBON                                         */}
      {/* ========================================================================= */}
      <div className="metrics-ribbon">
        <div className="metric-tile blue">
          <div className="metric-label">Features &amp; Telemetry Rows</div>
          <div className="metric-value-row">
            <span className="metric-value font-mono">
              {(dbOverview?.tables?.features?.count ?? 0).toLocaleString()}
            </span>
            <span className="metric-unit">ROWS</span>
          </div>
          <div className="metric-footer">Real-Time Extracted Vibration FFT Records</div>
        </div>

        <div className="metric-tile green">
          <div className="metric-label">Decisions &amp; Safety Trips</div>
          <div className="metric-value-row">
            <span className="metric-value font-mono">
              {(dbOverview?.tables?.decisions?.count ?? 0).toLocaleString()}
            </span>
            <span className="metric-unit">RECORDS</span>
          </div>
          <div className="metric-footer">Closed-Loop Machine Safety Transitions</div>
        </div>

        <div className="metric-tile purple">
          <div className="metric-label">AI Anomaly Scores Stored</div>
          <div className="metric-value-row">
            <span className="metric-value font-mono">
              {(dbOverview?.tables?.anomaly_scores?.count ?? 0).toLocaleString()}
            </span>
            <span className="metric-unit">SCORES</span>
          </div>
          <div className="metric-footer">Inference Logs &amp; Model Confidence History</div>
        </div>

        <div className="metric-tile orange">
          <div className="metric-label">Gold-Standard Dataset Sessions</div>
          <div className="metric-value-row">
            <span className="metric-value font-mono">{recordings.length}</span>
            <span className="metric-unit">SESSIONS</span>
          </div>
          <div className="metric-footer">
            {normalCount} Normal &bull; {disturbedCount} Disturbed ({totalWindows} windows)
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* PROFESSIONAL DATABASE EXPLORER TAB BAR                                    */}
      {/* ========================================================================= */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          background: '#ffffff',
          padding: '0.65rem 1.25rem',
          borderRadius: 8,
          border: '1px solid var(--border-color)',
        }}
      >
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            onClick={() => handleTabChange('features')}
            className={`filter-pill ${activeTab === 'features' ? 'active' : ''}`}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', padding: '0.45rem 0.95rem' }}
          >
            <Activity size={15} />
            <span>Vibration Features Table ({(dbOverview?.tables?.features?.count ?? 0).toLocaleString()})</span>
          </button>

          <button
            onClick={() => handleTabChange('decisions')}
            className={`filter-pill ${activeTab === 'decisions' ? 'active' : ''}`}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', padding: '0.45rem 0.95rem' }}
          >
            <ShieldCheck size={15} />
            <span>Safety Decisions Table ({(dbOverview?.tables?.decisions?.count ?? 0).toLocaleString()})</span>
          </button>

          <button
            onClick={() => handleTabChange('scores')}
            className={`filter-pill ${activeTab === 'scores' ? 'active' : ''}`}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', padding: '0.45rem 0.95rem' }}
          >
            <Cpu size={15} />
            <span>AI Anomaly Scores ({(dbOverview?.tables?.anomaly_scores?.count ?? 0).toLocaleString()})</span>
          </button>

          <button
            onClick={() => handleTabChange('recordings')}
            className={`filter-pill ${activeTab === 'recordings' ? 'active' : ''}`}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', padding: '0.45rem 0.95rem' }}
          >
            <Database size={15} />
            <span>Recorded Datasets ({recordings.length})</span>
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: '#059669', fontWeight: 600 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', display: 'inline-block' }}></span>
            <span>REAL-TIME DATABASE SYNC</span>
          </div>

          <button
            onClick={async () => {
              setIsRefreshing(true);
              await refreshRecordings();
              await fetchDbOverview();
              if (activeTab === 'features') await fetchFeatures();
              if (activeTab === 'decisions') await fetchDecisions();
              if (activeTab === 'scores') await fetchScores();
              setIsRefreshing(false);
            }}
            className="jog-btn"
            style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
            title="Refresh database live tables"
          >
            <RefreshCw size={14} className={isRefreshing ? 'spin-smooth' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: VIBRATION FEATURES TABLE (REAL-TIME DATABASE)                      */}
      {/* ========================================================================= */}
      {activeTab === 'features' && (
        <div className="b2b-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Activity size={18} color="#0284c7" />
                <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>
                  Live Vibration Features Table (<code>features</code>)
                </h2>
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>
                Real-time extracted spectral &amp; time-domain vibration data from hardware sensors. Click <strong>Edit</strong> to modify rows directly in the database.
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <button
                onClick={() => setCreateFeatModal(true)}
                className="jog-btn"
                style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', fontWeight: 600, background: '#eff6ff', borderColor: '#bfdbfe', color: '#1e40af' }}
              >
                <Plus size={14} />
                <span>Insert New Record</span>
              </button>
            </div>
          </div>

          {/* Search & Controls */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginTop: '1rem', marginBottom: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#f8fafc', border: '1px solid var(--border-color)', borderRadius: 6, padding: '0.4rem 0.75rem', width: '320px' }}>
              <Search size={15} color="#94a3b8" />
              <input
                type="text"
                placeholder="Search by device MAC or station ID..."
                value={featuresSearch}
                onChange={(e) => {
                  setFeaturesSearch(e.target.value);
                  setFeaturesPage(0);
                }}
                style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: '0.82rem', width: '100%', color: 'var(--text-main)' }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                Showing {featureRows.length} of {featuresTotal.toLocaleString()} records &bull; Page {featuresPage + 1}
              </span>
              <button
                onClick={() => setFeaturesPage((p) => Math.max(0, p - 1))}
                disabled={featuresPage === 0}
                className="jog-btn"
                style={{ padding: '0.3rem 0.5rem' }}
              >
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={() => setFeaturesPage((p) => p + 1)}
                disabled={(featuresPage + 1) * featuresLimit >= featuresTotal}
                className="jog-btn"
                style={{ padding: '0.3rem 0.5rem' }}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          {/* Features Table */}
          <table className="b2b-table" style={{ marginTop: '0.75rem' }}>
            <thead>
              <tr>
                <th>ID</th>
                <th>Timestamp (UTC)</th>
                <th>Station</th>
                <th>Device ID</th>
                <th>RMS (g)</th>
                <th>Peak (g)</th>
                <th>Crest Factor</th>
                <th>Kurtosis</th>
                <th>Dominant Freq (Hz)</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoadingFeatures ? (
                <tr>
                  <td colSpan={10} style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
                    Loading database records...
                  </td>
                </tr>
              ) : featureRows.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ textAlign: 'center', padding: '2.5rem', color: '#94a3b8' }}>
                    No features found in database.
                  </td>
                </tr>
              ) : (
                featureRows.map((f) => (
                  <tr key={f.id}>
                    <td className="font-mono" style={{ fontWeight: 700, color: '#2563eb' }}>
                      #{f.id}
                    </td>
                    <td style={{ fontSize: '0.78rem', color: '#64748b' }}>
                      {f.ts ? new Date(f.ts).toLocaleString() : 'N/A'}
                    </td>
                    <td style={{ fontWeight: 600 }}>{f.station_id || 'station-A'}</td>
                    <td className="font-mono" style={{ fontSize: '0.78rem' }}>{f.device_id}</td>
                    <td className="font-mono" style={{ fontWeight: 700, color: f.rms > 0.35 ? '#ef4444' : '#10b981' }}>
                      {Number(f.rms).toFixed(4)}
                    </td>
                    <td className="font-mono">{Number(f.peak).toFixed(4)}</td>
                    <td className="font-mono">{Number(f.crest_factor).toFixed(2)}</td>
                    <td className="font-mono">{Number(f.kurtosis).toFixed(2)}</td>
                    <td className="font-mono" style={{ color: '#0284c7' }}>
                      {Number(f.dominant_freq).toFixed(1)} Hz
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '0.35rem' }}>
                        <button
                          onClick={() => openEditFeature(f)}
                          className="jog-btn"
                          style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem', color: '#2563eb' }}
                          title="Edit this feature row in database"
                        >
                          <Edit3 size={12} />
                          <span>Edit</span>
                        </button>
                        <button
                          onClick={() => handleDeleteFeature(f.id)}
                          className="jog-btn"
                          style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem', color: '#ef4444' }}
                          title="Delete row"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: SAFETY DECISIONS TABLE (REAL-TIME DATABASE)                        */}
      {/* ========================================================================= */}
      {activeTab === 'decisions' && (
        <div className="b2b-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <ShieldCheck size={18} color="#0284c7" />
                <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>
                  Closed-Loop Safety Decisions Table (<code>decisions</code>)
                </h2>
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>
                Audit history of all machine states, speed reduction commands, trips, and operator interlocks. Click <strong>Edit</strong> to modify decision logs.
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>Filter State:</span>
              {['ALL', 'NORMAL', 'REDUCED_SPEED', 'STOPPED', 'WARNING'].map((st) => (
                <button
                  key={st}
                  onClick={() => {
                    setDecisionStateFilter(st);
                    setDecisionsPage(0);
                  }}
                  className={`filter-pill ${decisionStateFilter === st ? 'active' : ''}`}
                  style={{ fontSize: '0.75rem' }}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          {/* Pagination Controls */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
              Total Decisions: {decisionsTotal.toLocaleString()} &bull; Page {decisionsPage + 1}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <button
                onClick={() => setDecisionsPage((p) => Math.max(0, p - 1))}
                disabled={decisionsPage === 0}
                className="jog-btn"
                style={{ padding: '0.3rem 0.5rem' }}
              >
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={() => setDecisionsPage((p) => p + 1)}
                disabled={(decisionsPage + 1) * 25 >= decisionsTotal}
                className="jog-btn"
                style={{ padding: '0.3rem 0.5rem' }}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          {/* Decisions Table */}
          <table className="b2b-table" style={{ marginTop: '0.75rem' }}>
            <thead>
              <tr>
                <th>ID</th>
                <th>Timestamp</th>
                <th>Machine State</th>
                <th>Light</th>
                <th>Speed Cmd</th>
                <th>Layer Caused</th>
                <th>Decision Reason</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoadingDecisions ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
                    Loading decisions...
                  </td>
                </tr>
              ) : decisionRows.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '2.5rem', color: '#94a3b8' }}>
                    No decisions found matching filter.
                  </td>
                </tr>
              ) : (
                decisionRows.map((d) => (
                  <tr key={d.id}>
                    <td className="font-mono" style={{ fontWeight: 700, color: '#2563eb' }}>
                      #{d.id}
                    </td>
                    <td style={{ fontSize: '0.78rem', color: '#64748b' }}>
                      {d.ts ? new Date(d.ts).toLocaleString() : 'N/A'}
                    </td>
                    <td>
                      <span
                        style={{
                          padding: '0.2rem 0.55rem',
                          borderRadius: 4,
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          background:
                            d.state === 'NORMAL'
                              ? '#ecfdf5'
                              : d.state === 'REDUCED_SPEED'
                              ? '#ffedd5'
                              : d.state === 'STOPPED'
                              ? '#fef2f2'
                              : '#fef3c7',
                          color:
                            d.state === 'NORMAL'
                              ? '#065f46'
                              : d.state === 'REDUCED_SPEED'
                              ? '#c2410c'
                              : d.state === 'STOPPED'
                              ? '#991b1b'
                              : '#92400e',
                          border: `1px solid ${
                            d.state === 'NORMAL'
                              ? '#a7f3d0'
                              : d.state === 'REDUCED_SPEED'
                              ? '#fed7aa'
                              : d.state === 'STOPPED'
                              ? '#fecaca'
                              : '#fde68a'
                          }`,
                        }}
                      >
                        {d.state}
                      </span>
                    </td>
                    <td>
                      <span
                        style={{
                          display: 'inline-block',
                          width: 10,
                          height: 10,
                          borderRadius: '50%',
                          background:
                            d.indicator_light === 'GREEN'
                              ? '#10b981'
                              : d.indicator_light === 'AMBER'
                              ? '#f59e0b'
                              : '#ef4444',
                        }}
                      />
                    </td>
                    <td className="font-mono">{d.commanded_speed_pct}%</td>
                    <td>
                      <span className="font-mono" style={{ fontSize: '0.72rem', color: '#64748b' }}>
                        {d.layer_caused}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.78rem', color: '#334155', maxWidth: '380px' }} title={d.reason}>
                      {d.reason}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '0.35rem' }}>
                        <button
                          onClick={() => openEditDecision(d)}
                          className="jog-btn"
                          style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem', color: '#2563eb' }}
                          title="Edit decision in database"
                        >
                          <Edit3 size={12} />
                          <span>Edit</span>
                        </button>
                        <button
                          onClick={() => handleDeleteDecision(d.id)}
                          className="jog-btn"
                          style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem', color: '#ef4444' }}
                          title="Delete row"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: AI ANOMALY SCORES TABLE (REAL-TIME DATABASE)                       */}
      {/* ========================================================================= */}
      {activeTab === 'scores' && (
        <div className="b2b-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Cpu size={18} color="#8b5cf6" />
                <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>
                  AI Anomaly Scores Inference Table (<code>anomaly_scores</code>)
                </h2>
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>
                Real-time machine learning predictions recorded across production shifts.
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                Total Scores: {scoresTotal.toLocaleString()} &bull; Page {scoresPage + 1}
              </span>
              <button
                onClick={() => setScoresPage((p) => Math.max(0, p - 1))}
                disabled={scoresPage === 0}
                className="jog-btn"
                style={{ padding: '0.3rem 0.5rem' }}
              >
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={() => setScoresPage((p) => p + 1)}
                disabled={(scoresPage + 1) * 25 >= scoresTotal}
                className="jog-btn"
                style={{ padding: '0.3rem 0.5rem' }}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          <table className="b2b-table" style={{ marginTop: '0.75rem' }}>
            <thead>
              <tr>
                <th>ID</th>
                <th>Timestamp</th>
                <th>Model Version</th>
                <th>Raw Score (0-1)</th>
                <th>Smoothed Score</th>
                <th>Machine State</th>
              </tr>
            </thead>
            <tbody>
              {isLoadingScores ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
                    Loading scores...
                  </td>
                </tr>
              ) : scoreRows.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '2.5rem', color: '#94a3b8' }}>
                    No anomaly scores found.
                  </td>
                </tr>
              ) : (
                scoreRows.map((s) => (
                  <tr key={s.id}>
                    <td className="font-mono" style={{ fontWeight: 700, color: '#8b5cf6' }}>
                      #{s.id}
                    </td>
                    <td style={{ fontSize: '0.78rem', color: '#64748b' }}>
                      {s.ts ? new Date(s.ts).toLocaleString() : 'N/A'}
                    </td>
                    <td className="font-mono" style={{ fontSize: '0.78rem' }}>
                      {s.model_version || 'v1.4.0-tuned'}
                    </td>
                    <td className="font-mono" style={{ fontWeight: 700, color: s.raw_score >= 0.45 ? '#ef4444' : '#10b981' }}>
                      {Number(s.raw_score).toFixed(4)}
                    </td>
                    <td className="font-mono" style={{ fontWeight: 700, color: s.smoothed_score >= 0.45 ? '#ef4444' : '#10b981' }}>
                      {Number(s.smoothed_score).toFixed(4)}
                    </td>
                    <td>
                      <span className="font-mono" style={{ fontSize: '0.72rem' }}>{s.state}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: RECORDED DATASETS CATALOG (GOLD-STANDARD SESSIONS)                 */}
      {/* ========================================================================= */}
      {activeTab === 'recordings' && (
        <div className="b2b-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Database size={18} color="#0284c7" />
                <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>
                  Dataset Recording Sessions &amp; Metadata
                </h2>
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>
                Datasets stored in SQLite &amp; JSON storage. You can view, edit session name/label, download, or delete records.
              </div>
            </div>

            {/* Quick Capture Buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              {!isRecording ? (
                <>
                  <button
                    onClick={() => handleStartCapture('normal')}
                    className="jog-btn"
                    style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', fontWeight: 600, background: '#ecfdf5', borderColor: '#a7f3d0', color: '#065f46' }}
                    title="Stream and record normal baseline packets"
                  >
                    <PlusCircle size={15} color="#10b981" />
                    <span>Record Normal</span>
                  </button>
                  <button
                    onClick={() => handleStartCapture('disturbed')}
                    className="jog-btn"
                    style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', fontWeight: 600, background: '#fef2f2', borderColor: '#fecaca', color: '#991b1b' }}
                    title="Stream and record disturbed fault packets"
                  >
                    <PlusCircle size={15} color="#ef4444" />
                    <span>Record Disturbed</span>
                  </button>
                </>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: '#fffbeb', border: '1px solid #fde68a', padding: '0.35rem 0.85rem', borderRadius: 6 }}>
                  <span className="motor-pulse-dot red"></span>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#92400e' }}>
                    RECORDING {activeLabel.toUpperCase()} ({recElapsed}s)
                  </span>
                  <button
                    onClick={handleStopCapture}
                    style={{
                      padding: '0.25rem 0.75rem',
                      background: '#dc2626',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 4,
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.3rem',
                    }}
                  >
                    <Square size={12} />
                    <span>Save Dataset</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Filter and Search Bar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginTop: '1rem', marginBottom: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#f8fafc', border: '1px solid var(--border-color)', borderRadius: 6, padding: '0.4rem 0.75rem', width: '320px' }}>
              <Search size={15} color="#94a3b8" />
              <input
                type="text"
                placeholder="Search by ID, session name..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: '0.82rem', width: '100%', color: 'var(--text-main)' }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <Filter size={13} /> Filter:
              </span>
              <button
                onClick={() => setFilterLabel('all')}
                className={`filter-pill ${filterLabel === 'all' ? 'active' : ''}`}
              >
                All ({recordings.length})
              </button>
              <button
                onClick={() => setFilterLabel('normal')}
                className={`filter-pill ${filterLabel === 'normal' ? 'active' : ''}`}
              >
                Normal Baseline ({normalCount})
              </button>
              <button
                onClick={() => setFilterLabel('disturbed')}
                className={`filter-pill ${filterLabel === 'disturbed' ? 'active' : ''}`}
              >
                Disturbed Fault ({disturbedCount})
              </button>
            </div>
          </div>

          {/* Recordings Table */}
          <table className="b2b-table" style={{ marginTop: '0.75rem' }}>
            <thead>
              <tr>
                <th>ID</th>
                <th>Session Name</th>
                <th>Classification Label</th>
                <th>Sample Count</th>
                <th>Duration</th>
                <th>Created Timestamp</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecordings.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '2.5rem', color: '#94a3b8' }}>
                    No recordings found matching "{searchTerm}". Use "Record Normal" or "Record Disturbed" to capture live sensor packets.
                  </td>
                </tr>
              ) : (
                filteredRecordings.map((r) => (
                  <tr key={r.id}>
                    <td className="font-mono" style={{ fontWeight: 700, color: 'var(--primary)', fontSize: '0.82rem' }}>
                      {r.id}
                    </td>
                    <td style={{ fontWeight: 600, color: 'var(--text-main)' }}>{r.name}</td>
                    <td>
                      <span
                        style={{
                          padding: '0.2rem 0.6rem',
                          borderRadius: 4,
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          background: r.label === 'normal' ? '#ecfdf5' : '#fef2f2',
                          color: r.label === 'normal' ? '#065f46' : '#991b1b',
                          border: `1px solid ${r.label === 'normal' ? '#a7f3d0' : '#fecaca'}`,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.3rem',
                        }}
                      >
                        {r.label === 'normal' ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                        {r.label.toUpperCase()}
                      </span>
                    </td>
                    <td className="font-mono">{r.sample_count} windows</td>
                    <td className="font-mono" style={{ color: '#475569' }}>
                      {r.duration_sec}s
                    </td>
                    <td style={{ fontSize: '0.78rem', color: '#64748b' }}>
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '0.35rem' }}>
                        <button
                          onClick={() => openEditRecording(r)}
                          className="jog-btn"
                          style={{ padding: '0.25rem 0.55rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem', color: '#2563eb' }}
                          title="Edit dataset name or label in database"
                        >
                          <Edit3 size={13} />
                          <span>Edit</span>
                        </button>
                        <button
                          onClick={() => handleInspect(r.id)}
                          disabled={isLoadingInspect}
                          className="jog-btn"
                          style={{ padding: '0.25rem 0.55rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                          title="Inspect feature vector preview"
                        >
                          <Eye size={13} color="#0284c7" className={isLoadingInspect ? 'spin-smooth' : ''} />
                          <span>Inspect</span>
                        </button>
                        <button
                          onClick={() => handleDeleteRecording(r.id)}
                          className="jog-btn"
                          style={{ padding: '0.25rem 0.55rem', fontSize: '0.75rem', color: '#ef4444' }}
                          title="Delete recording session"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: EDIT RECORDING SESSION                                           */}
      {/* ========================================================================= */}
      {editRecModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            backdropFilter: 'blur(3px)',
            padding: '1.5rem',
          }}
        >
          <div
            className="b2b-card"
            style={{ width: '100%', maxWidth: '500px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.3)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Edit3 size={18} color="#2563eb" />
                <span style={{ fontWeight: 700, fontSize: '1rem' }}>Edit Dataset Recording</span>
              </div>
              <button onClick={() => setEditRecModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '0.35rem' }}>
                  RECORDING ID (IMMUTABLE)
                </label>
                <input
                  type="text"
                  disabled
                  value={editRecModal.id}
                  style={{ width: '100%', padding: '0.5rem', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 6, fontFamily: 'monospace' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '0.35rem' }}>
                  SESSION NAME
                </label>
                <input
                  type="text"
                  value={editRecName}
                  onChange={(e) => setEditRecName(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: 6 }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '0.35rem' }}>
                  CLASSIFICATION LABEL
                </label>
                <select
                  value={editRecLabel}
                  onChange={(e) => setEditRecLabel(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: 6 }}
                >
                  <option value="normal">normal (Nominal Baseline)</option>
                  <option value="disturbed">disturbed (Resonance / Mechanical Fault)</option>
                </select>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.65rem', marginTop: '0.5rem' }}>
                <button onClick={() => setEditRecModal(null)} className="jog-btn">
                  Cancel
                </button>
                <button
                  onClick={handleSaveRecording}
                  disabled={isSavingRec}
                  className="jog-btn"
                  style={{ background: '#2563eb', color: '#fff', border: 'none', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                >
                  <Save size={14} />
                  <span>{isSavingRec ? 'Saving...' : 'Save Changes'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: EDIT FEATURE RECORD                                              */}
      {/* ========================================================================= */}
      {editFeatModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            backdropFilter: 'blur(3px)',
            padding: '1.5rem',
          }}
        >
          <div className="b2b-card" style={{ width: '100%', maxWidth: '480px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Edit3 size={18} color="#2563eb" />
                <span style={{ fontWeight: 700, fontSize: '1rem' }}>Edit Feature Record #{editFeatModal.id}</span>
              </div>
              <button onClick={() => setEditFeatModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                  RMS VIBRATION (g)
                </label>
                <input
                  type="number"
                  step="0.001"
                  value={featRms}
                  onChange={(e) => setFeatRms(parseFloat(e.target.value) || 0)}
                  style={{ width: '100%', padding: '0.45rem', border: '1px solid #cbd5e1', borderRadius: 6 }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                  PEAK ACCELERATION (g)
                </label>
                <input
                  type="number"
                  step="0.001"
                  value={featPeak}
                  onChange={(e) => setFeatPeak(parseFloat(e.target.value) || 0)}
                  style={{ width: '100%', padding: '0.45rem', border: '1px solid #cbd5e1', borderRadius: 6 }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                  DOMINANT FREQ (Hz)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={featFreq}
                  onChange={(e) => setFeatFreq(parseFloat(e.target.value) || 0)}
                  style={{ width: '100%', padding: '0.45rem', border: '1px solid #cbd5e1', borderRadius: 6 }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                  KURTOSIS
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={featKurt}
                  onChange={(e) => setFeatKurt(parseFloat(e.target.value) || 0)}
                  style={{ width: '100%', padding: '0.45rem', border: '1px solid #cbd5e1', borderRadius: 6 }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.65rem', marginTop: '1.25rem' }}>
              <button onClick={() => setEditFeatModal(null)} className="jog-btn">
                Cancel
              </button>
              <button
                onClick={handleSaveFeature}
                className="jog-btn"
                style={{ background: '#2563eb', color: '#fff', border: 'none', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
              >
                <Save size={14} />
                <span>Save to Database</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: INSERT NEW FEATURE RECORD                                        */}
      {/* ========================================================================= */}
      {createFeatModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            backdropFilter: 'blur(3px)',
            padding: '1.5rem',
          }}
        >
          <div className="b2b-card" style={{ width: '100%', maxWidth: '480px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Plus size={18} color="#10b981" />
                <span style={{ fontWeight: 700, fontSize: '1rem' }}>Insert Vibration Feature Record</span>
              </div>
              <button onClick={() => setCreateFeatModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                  RMS VIBRATION (g)
                </label>
                <input
                  type="number"
                  step="0.001"
                  value={newFeatRms}
                  onChange={(e) => setNewFeatRms(parseFloat(e.target.value) || 0)}
                  style={{ width: '100%', padding: '0.45rem', border: '1px solid #cbd5e1', borderRadius: 6 }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                  PEAK ACCELERATION (g)
                </label>
                <input
                  type="number"
                  step="0.001"
                  value={newFeatPeak}
                  onChange={(e) => setNewFeatPeak(parseFloat(e.target.value) || 0)}
                  style={{ width: '100%', padding: '0.45rem', border: '1px solid #cbd5e1', borderRadius: 6 }}
                />
              </div>

              <div style={{ gridColumn: 'span 2' }}>
                <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                  DOMINANT FREQ (Hz)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={newFeatFreq}
                  onChange={(e) => setNewFeatFreq(parseFloat(e.target.value) || 0)}
                  style={{ width: '100%', padding: '0.45rem', border: '1px solid #cbd5e1', borderRadius: 6 }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.65rem', marginTop: '1.25rem' }}>
              <button onClick={() => setCreateFeatModal(false)} className="jog-btn">
                Cancel
              </button>
              <button
                onClick={handleCreateFeature}
                className="jog-btn"
                style={{ background: '#10b981', color: '#fff', border: 'none', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
              >
                <Plus size={14} />
                <span>Insert Record</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 4: EDIT DECISION RECORD                                             */}
      {/* ========================================================================= */}
      {editDecModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            backdropFilter: 'blur(3px)',
            padding: '1.5rem',
          }}
        >
          <div className="b2b-card" style={{ width: '100%', maxWidth: '520px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Edit3 size={18} color="#2563eb" />
                <span style={{ fontWeight: 700, fontSize: '1rem' }}>Edit Safety Decision Record #{editDecModal.id}</span>
              </div>
              <button onClick={() => setEditDecModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div>
                <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                  STATE
                </label>
                <select
                  value={decState}
                  onChange={(e) => setDecState(e.target.value)}
                  style={{ width: '100%', padding: '0.45rem', border: '1px solid #cbd5e1', borderRadius: 6 }}
                >
                  <option value="NORMAL">NORMAL (100% Speed / Green)</option>
                  <option value="REDUCED_SPEED">REDUCED_SPEED (50% Speed / Amber)</option>
                  <option value="STOPPED">STOPPED (0 RPM / Red)</option>
                  <option value="WARNING">WARNING (Manual Mode Alert / Amber)</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                  COMMANDED SPEED PCT (%)
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={decSpeed}
                  onChange={(e) => setDecSpeed(parseFloat(e.target.value) || 0)}
                  style={{ width: '100%', padding: '0.45rem', border: '1px solid #cbd5e1', borderRadius: 6 }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                  DECISION REASON
                </label>
                <textarea
                  rows={3}
                  value={decReason}
                  onChange={(e) => setDecReason(e.target.value)}
                  style={{ width: '100%', padding: '0.45rem', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '0.82rem' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.65rem', marginTop: '0.5rem' }}>
                <button onClick={() => setEditDecModal(null)} className="jog-btn">
                  Cancel
                </button>
                <button
                  onClick={handleSaveDecision}
                  className="jog-btn"
                  style={{ background: '#2563eb', color: '#fff', border: 'none', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                >
                  <Save size={14} />
                  <span>Update Decision</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 5: DATASET INSPECTION MODAL                                         */}
      {/* ========================================================================= */}
      {inspectItem && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            backdropFilter: 'blur(3px)',
            padding: '1.5rem',
          }}
        >
          <div
            className="b2b-card"
            style={{
              width: '100%',
              maxWidth: '820px',
              maxHeight: '85vh',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.3)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Database size={18} color="#0284c7" />
                  <span style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-main)' }}>
                    Dataset Inspection: {inspectItem.name}
                  </span>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  ID: <code className="font-mono">{inspectItem.id}</code> &bull; Label:{' '}
                  <strong style={{ color: inspectItem.label === 'normal' ? '#10b981' : '#ef4444' }}>
                    {inspectItem.label.toUpperCase()}
                  </strong> &bull; Samples: {inspectItem.sample_count} &bull; Duration: {inspectItem.duration_sec}s
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <button
                  onClick={() => handleExportJson(inspectItem, `${inspectItem.id}_dataset`)}
                  className="jog-btn"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem' }}
                >
                  <Download size={13} />
                  <span>Download JSON</span>
                </button>
                <button
                  onClick={() => setInspectItem(null)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            <div style={{ overflowY: 'auto', flex: 1, marginTop: '1rem', paddingRight: '0.5rem' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '0.5rem' }}>
                First 25 Time-Domain &amp; Spectral Feature Windows:
              </div>
              <div style={{ background: '#0f172a', padding: '1rem', borderRadius: 8, overflowX: 'auto' }}>
                <pre style={{ margin: 0, fontSize: '0.72rem', color: '#38bdf8', fontFamily: 'monospace' }}>
                  {JSON.stringify(inspectItem.samples_preview || [], null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
