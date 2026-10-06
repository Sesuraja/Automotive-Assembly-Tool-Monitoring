import asyncio
import json
from typing import Set, Dict, Any
from fastapi import WebSocket

class LiveHub:
    """
    Manages active WebSocket connections for the live dashboard stream (/ws/live).
    Broadcasts real-time features, anomaly scores, decision state, and spectra at 10-20 Hz.
    """
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()
        self.last_broadcast_state: Dict[str, Any] = {}

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)
        # Send most recent cached state immediately on connect
        if self.last_broadcast_state:
            try:
                await websocket.send_text(json.dumps(self.last_broadcast_state, default=str))
            except Exception:
                pass

    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)

    async def broadcast(self, data: Dict[str, Any]):
        self.last_broadcast_state = data
        if not self.active_connections:
            return
            
        message = json.dumps(data, default=str)
        dead_connections = set()
        
        for connection in list(self.active_connections):
            try:
                await connection.send_text(message)
            except Exception:
                dead_connections.add(connection)
                
        for dead in dead_connections:
            self.active_connections.discard(dead)

live_hub = LiveHub()
