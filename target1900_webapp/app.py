from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from typing import Any, Dict

from flask import Flask, jsonify, request, send_from_directory

APP_DIR = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("DB_PATH", str(APP_DIR / "highscores.sqlite3")))

# 固定：礫隊のハイスコアのみ保存
TEAM_NAME = "礫隊"

app = Flask(__name__, static_folder="static", static_url_path="/")


def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """CREATE TABLE IF NOT EXISTS highscores (
            team TEXT PRIMARY KEY,
            best INTEGER NOT NULL
        )"""
    )
    return conn


@app.get("/api/ping")
def ping():
    return jsonify({"ok": True})



@app.get("/api/highscore")
def get_highscore():
    with _db() as conn:
        cur = conn.execute("SELECT best FROM highscores WHERE team=?", (TEAM_NAME,))
        row = cur.fetchone()
        best = int(row[0]) if row else 0
    return jsonify({"team": TEAM_NAME, "best": best})


@app.post("/api/highscore")
def post_highscore():
    data: Dict[str, Any] = request.get_json(silent=True) or {}
    score = data.get("score")
    try:
        score_int = int(score)
    except Exception:
        return jsonify({"error": "score must be an integer"}), 400
    if score_int < 0:
        score_int = 0

    with _db() as conn:
        cur = conn.execute("SELECT best FROM highscores WHERE team=?", (TEAM_NAME,))
        row = cur.fetchone()
        old_best = int(row[0]) if row else 0
        best = old_best

        # 更新されれば更新されたスコアのみ残す（＝過去最高より高い時だけ上書き）
        updated = False
        if score_int > old_best:
            updated = True
            if row:
                conn.execute("UPDATE highscores SET best=? WHERE team=?", (score_int, TEAM_NAME))
            else:
                conn.execute("INSERT INTO highscores(team, best) VALUES(?,?)", (TEAM_NAME, score_int))
            best = score_int
        conn.commit()

    return jsonify({"team": TEAM_NAME, "best": best, "updated": updated})


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/<path:path>")
def static_proxy(path: str):
    return send_from_directory(app.static_folder, path)


if __name__ == "__main__":
    # ローカル開発用
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")), debug=True)
