"""
Aperture Automotive Assembly Tool Monitoring - Master Process Runner
Starts both the FastAPI Backend (Uvicorn on :8000) and the Vite Frontend (:5173).
"""

import sys
import os
import subprocess
import time
import signal
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = ROOT_DIR / "frontend"

def main():
    print("=" * 72)
    print("  AUTOMOTIVE ASSEMBLY TOOL MONITORING PLATFORM")
    print("  AI-Powered Vibration Anomaly Detection & Safety Interlock")
    print("=" * 72)

    # 1. Load and print environment info
    env_file = ROOT_DIR / ".env"
    vendor_url = "https://ais-dev-xzxljhsxlkzopqgvxgcwvc-509615976446.asia-southeast1.run.app"
    if env_file.exists():
        with open(env_file, "r") as f:
            for line in f:
                if line.startswith("VENDOR_API_BASE_URL="):
                    vendor_url = line.split("=", 1)[1].strip()

    print(f"[*] Environment Config: Loaded from {env_file}")
    print(f"[*] Cloud Run Host Target: {vendor_url}")
    print(f"[*] Backend Server Port:   http://127.0.0.1:8000")
    print(f"[*] Frontend Dashboard:    http://localhost:5173")
    print(f"[*] Interactive API Docs:  http://127.0.0.1:8000/docs")
    print("-" * 72)

    processes = []

    # 2. Launch FastAPI backend via uvicorn
    backend_cmd = [
        sys.executable,
        "-m",
        "uvicorn",
        "backend.app.main:app",
        "--host",
        "127.0.0.1",
        "--port",
        "8000",
        "--reload"
    ]
    print("[+] Launching Backend API Service (uvicorn)...")
    backend_proc = subprocess.Popen(backend_cmd, cwd=str(ROOT_DIR))
    processes.append(backend_proc)

    # 3. Launch Vite Frontend dev server
    npm_cmd = "npm.cmd" if os.name == "nt" else "npm"
    frontend_cmd = [npm_cmd, "run", "dev"]
    print("[+] Launching Frontend Web Client (Vite)...")
    try:
        frontend_proc = subprocess.Popen(frontend_cmd, cwd=str(FRONTEND_DIR))
        processes.append(frontend_proc)
    except Exception as e:
        print(f"[!] Warning: Could not launch npm automatically ({e}).")
        print("[!] You can launch frontend manually: cd frontend && npm run dev")

    print("\n[OK] Both services are running! Press Ctrl+C to terminate all processes.\n")

    def shutdown(signum, frame):
        print("\n[*] Stopping all services...")
        for p in processes:
            try:
                p.terminate()
            except Exception:
                pass
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    try:
        while True:
            time.sleep(1)
            for p in processes:
                if p.poll() is not None:
                    # One of the processes exited
                    pass
    except KeyboardInterrupt:
        shutdown(None, None)

if __name__ == "__main__":
    main()
