import sqlite3
import os

db_path = "tool_monitor.db"
if not os.path.exists(db_path):
    print("Database file does not exist.")
    exit()

size_bytes = os.path.getsize(db_path)
size_mb = size_bytes / (1024 * 1024)
print(f"Database File: {db_path}")
print(f"Total File Size on Disk: {size_mb:.2f} MB ({size_bytes:,} bytes)")

conn = sqlite3.connect(db_path)
cur = conn.cursor()

page_size = cur.execute("PRAGMA page_size;").fetchone()[0]
page_count = cur.execute("PRAGMA page_count;").fetchone()[0]
freelist_count = cur.execute("PRAGMA freelist_count;").fetchone()[0]
free_bytes = freelist_count * page_size
free_mb = free_bytes / (1024 * 1024)
active_mb = size_mb - free_mb

print(f"\n--- SQLite Storage Metrics ---")
print(f"Page Size:       {page_size:,} bytes")
print(f"Total Pages:     {page_count:,}")
print(f"Freelist Pages:  {freelist_count:,} ({free_mb:.2f} MB unused / empty space, {(free_mb/max(size_mb,0.001))*100:.1f}%)")
print(f"Active Data:     {active_mb:.2f} MB ({((active_mb)/max(size_mb,0.001))*100:.1f}%)")

print("\n--- Table Statistics & Row Counts ---")
tables = cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';").fetchall()
table_stats = []
for (t,) in tables:
    cnt = cur.execute(f"SELECT count(*) FROM {t};").fetchone()[0]
    table_stats.append((t, cnt))

table_stats.sort(key=lambda x: x[1], reverse=True)
for t, cnt in table_stats:
    print(f" - {t:<22}: {cnt:,} rows")

if any(t[0] == "raw_windows" for t in tables):
    res = cur.execute("SELECT count(*), sum(length(window_json)), avg(length(window_json)) FROM raw_windows;").fetchone()
    if res[1]:
        print(f"\n[Detail] 'raw_windows' table:")
        print(f"   Row Count:           {res[0]:,}")
        print(f"   Total JSON Payload:  {res[1]/(1024*1024):.2f} MB")
        print(f"   Average Row Payload: {res[2]:,.1f} bytes per row")

if any(t[0] == "features" for t in tables):
    res = cur.execute("SELECT count(*) FROM features;").fetchone()
    print(f"\n[Detail] 'features' table: {res[0]:,} rows")

if any(t[0] == "anomaly_scores" for t in tables):
    res = cur.execute("SELECT count(*) FROM anomaly_scores;").fetchone()
    print(f"[Detail] 'anomaly_scores' table: {res[0]:,} rows")

conn.close()
