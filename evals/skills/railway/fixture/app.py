import os

from flask import Flask, jsonify

app = Flask(__name__)


@app.get("/")
def index():
    return "Lanternfish: all harbor lights nominal\n"


@app.get("/health")
def health():
    return jsonify(status="ok", store=bool(os.environ.get("DATABASE_URL")))
