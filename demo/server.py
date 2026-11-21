# Local-only static server + upload endpoint for recording the demo video.
# Usage: python3 server.py  (serves this folder on http://127.0.0.1:5179, POST /upload?name=demo.mp4 saves a file here)
import http.server, os, re

ROOT = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def do_POST(self):
        if not self.path.startswith("/upload"):
            self.send_error(404); return
        name = re.sub(r"[^A-Za-z0-9._-]", "", self.path.split("name=")[-1]) or "upload.bin"
        n = int(self.headers.get("Content-Length", 0))
        with open(os.path.join(ROOT, name), "wb") as f:
            f.write(self.rfile.read(n))
        self.send_response(200); self.end_headers(); self.wfile.write(b"ok")

http.server.ThreadingHTTPServer(("127.0.0.1", 5179), Handler).serve_forever()
