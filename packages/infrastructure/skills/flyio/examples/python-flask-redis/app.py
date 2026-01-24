from flask import Flask, jsonify
import redis
import os

app = Flask(__name__)

# Redis connection
redis_url = os.getenv('REDIS_URL', 'redis://localhost:6379')
cache = redis.from_url(redis_url, decode_responses=True)

@app.route('/health')
def health():
    return jsonify({"status": "healthy"}), 200

@app.route('/api/counter')
def counter():
    count = cache.incr('visits')
    return jsonify({"visits": count})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8000)
