"""Local, read-only preview for the classroom design drafts."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
ROUTES = {
    '/': (ROOT / 'docs/ui/classroom-plugin-prototype.html', 'text/html; charset=utf-8'),
    '/v1': (ROOT / 'docs/ui/classroom-prototype.html', 'text/html; charset=utf-8'),
    '/wenkai.woff2': (ROOT / 'packages/client/assets/notebook/fonts/wenkai.woff2', 'font/woff2'),
}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        item = ROUTES.get(urlsplit(self.path).path)
        if item is None:
            self.send_error(404)
            return
        data = item[0].read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', item[1])
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    with ThreadingHTTPServer(('127.0.0.1', 0), Handler) as server:
        print(f'Classroom preview: http://127.0.0.1:{server.server_port}/', flush=True)
        server.serve_forever()
