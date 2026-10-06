from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session
from backend.app.database import get_db
from backend.app.schemas.pydantic_models import IngestPayload
from backend.app.services.ingestion_service import IngestionService

router = APIRouter(tags=["Ingestion"])

@router.post("/ingest")
async def ingest_vibration_data(payload: IngestPayload, db: Session = Depends(get_db)):
    """
    HTTP Ingestion Endpoint (Hardware-agnostic).
    Accepts vibration data from BLE Gateway or Simulator.
    Returns motor control decisions (speed, indicator light, state).
    """
    feedback = await IngestionService.process_payload(payload, db=db)
    return feedback

@router.websocket("/ws/ingest")
async def websocket_ingest(websocket: WebSocket, db: Session = Depends(get_db)):
    """
    WebSocket Ingestion Endpoint for high-rate continuous streaming nodes.
    """
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_json()
            payload = IngestPayload(**data)
            feedback = await IngestionService.process_payload(payload, db=db)
            await websocket.send_json(feedback)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[WS Ingest Error] {e}")
        try:
            await websocket.close()
        except Exception:
            pass
