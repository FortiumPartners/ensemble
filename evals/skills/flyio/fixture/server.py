"""Inkpad: a tiny notes service. GET /healthz answers ok; GET /notes lists notes; POST /notes (header X-Api-Key) stores one."""
import os
import json
from http.server import BaseHTTPRequestHandler, HTTPServer

HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "3000"))
DATA_DIR = os.environ.get("DATA_DIR", "/data")
API_KEY = os.environ.get("API_KEY")

if not API_KEY:
    raise SystemExit("API_KEY is not set")


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/healthz":
            return self._send(200, {"ok": True})
        if self.path == "/notes":
            path = os.path.join(DATA_DIR, "notes.json")
            notes = json.load(open(path)) if os.path.exists(path) else []
            return self._send(200, notes)
        return self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.headers.get("X-Api-Key") != API_KEY:
            return self._send(401, {"error": "bad key"})
        length = int(self.headers.get("Content-Length", "0"))
        note = json.loads(self.rfile.read(length) or b"{}")
        os.makedirs(DATA_DIR, exist_ok=True)
        path = os.path.join(DATA_DIR, "notes.json")
        notes = json.load(open(path)) if os.path.exists(path) else []
        notes.append(note)
        with open(path, "w") as f:
            json.dump(notes, f)
        return self._send(201, note)


if __name__ == "__main__":
    HTTPServer((HOST, PORT), Handler).serve_forever()
