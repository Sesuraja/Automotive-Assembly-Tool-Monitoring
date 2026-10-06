import React from 'react';
import type { EventLogItem } from '../../types';
import { AlertTriangle, CheckCircle, ShieldAlert, Cpu } from 'lucide-react';
import { useAppSettings } from '../../context/AppSettingsContext';

interface EventTimelineProps {
  events: EventLogItem[];
}

export const EventTimeline: React.FC<EventTimelineProps> = ({ events: rawEvents }) => {
  const { formatTime } = useAppSettings();
  const events = Array.isArray(rawEvents) ? rawEvents : [];
  return (
    <div className="b2b-card" style={{ height: '100%' }}>
      <div className="b2b-card-header">
        <div>
          <div className="b2b-card-title">Safety & Control Event Timeline</div>
          <div className="b2b-card-subtitle">Real-time log of trips, warnings, and resets</div>
        </div>
        <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
          {events.length} events logged
        </div>
      </div>

      <div className="timeline-list">
        {events.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8', fontSize: '0.85rem' }}>
            No trip or reset events yet. Station operating normally.
          </div>
        ) : (
          events.map((ev, i) => {
            const isTrip = ev.event_type.includes('TRIP') || ev.event_type.includes('STOP');
            const isReset = ev.event_type.includes('RESET');
            const isWarn = ev.event_type.includes('SPEED') || ev.event_type.includes('WARN');

            return (
              <div
                key={ev.id || i}
                className={`timeline-item ${isTrip ? 'TRIP' : isWarn ? 'SPEED_CHANGE' : isReset ? 'RESET' : ''}`}
              >
                <div style={{ marginTop: '2px' }}>
                  {isTrip ? (
                    <ShieldAlert size={16} color="#ef4444" />
                  ) : isWarn ? (
                    <AlertTriangle size={16} color="#f59e0b" />
                  ) : isReset ? (
                    <CheckCircle size={16} color="#10b981" />
                  ) : (
                    <Cpu size={16} color="#0284c7" />
                  )}
                </div>

                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.8rem', color: '#1e293b' }}>
                      {ev.event_type.replace('_', ' ')}
                    </span>
                    <span className="timeline-time">
                      {formatTime(ev.ts)}
                    </span>
                  </div>
                  <div style={{ color: '#475569', marginTop: '2px', fontSize: '0.78rem' }}>
                    {ev.details}
                  </div>
                  {ev.notes && (
                    <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '2px', fontStyle: 'italic' }}>
                      Layer: {ev.notes} {ev.operator ? `• By: ${ev.operator}` : ''}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
