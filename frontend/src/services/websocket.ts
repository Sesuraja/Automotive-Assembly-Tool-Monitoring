import type { LiveTelemetry } from '../types';

type MessageHandler = (data: LiveTelemetry) => void;
type StatusHandler = (isConnected: boolean) => void;

export class LiveWebSocketClient {
  private ws: WebSocket | null = null;
  private messageHandlers: Set<MessageHandler> = new Set();
  private statusHandlers: Set<StatusHandler> = new Set();
  private reconnectTimer: any = null;
  private pingInterval: any = null;
  private isExplicitlyClosed = false;

  constructor() {
    this.connect();
  }

  public connect() {
    this.isExplicitlyClosed = false;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    // If running in Vite dev mode on 5173, backend is on 8000
    const wsUrl =
      host.includes(':5173') || host.includes(':3000')
        ? 'ws://localhost:8000/ws/live'
        : `${protocol}//${host}/ws/live`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.notifyStatus(true);
        this.startHeartbeat();
      };

      this.ws.onmessage = (event) => {
        try {
          if (event.data === 'pong') return;
          const data: LiveTelemetry = JSON.parse(event.data);
          this.notifyMessage(data);
        } catch (e) {
          // ignore parse errors
        }
      };

      this.ws.onclose = () => {
        this.notifyStatus(false);
        this.stopHeartbeat();
        if (!this.isExplicitlyClosed) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = () => {
        this.notifyStatus(false);
      };
    } catch (e) {
      this.scheduleReconnect();
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send('ping');
      }
    }, 5000);
  }

  private stopHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 2000);
  }

  public onMessage(handler: MessageHandler) {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  public onStatus(handler: StatusHandler) {
    this.statusHandlers.add(handler);
    if (this.ws) {
      handler(this.ws.readyState === WebSocket.OPEN);
    }
    return () => this.statusHandlers.delete(handler);
  }

  private notifyMessage(data: LiveTelemetry) {
    for (const h of this.messageHandlers) {
      try {
        h(data);
      } catch (e) {
        console.error(e);
      }
    }
  }

  private notifyStatus(isConnected: boolean) {
    for (const h of this.statusHandlers) {
      try {
        h(isConnected);
      } catch (e) {
        console.error(e);
      }
    }
  }

  public disconnect() {
    this.isExplicitlyClosed = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export const liveWs = new LiveWebSocketClient();
