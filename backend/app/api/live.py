from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from backend.app.core.live_hub import live_hub

router = APIRouter(tags=["Live Telemetry Stream"])

@router.websocket("/ws/live")
async def websocket_live_stream(websocket: WebSocket):
    """
    High-frequency live broadcast WebSocket for frontend dashboard clients.
    Streams 10-20 Hz live updates of features, anomaly scores, decisions, speeds, and spectra.
    """
    await live_hub.connect(websocket)
    try:
        while True:
            # Keep-alive ping/pong
            msg = await websocket.receive_text()
            if msg == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        live_hub.disconnect(websocket)
    except Exception:
        live_hub.disconnect(websocket)
