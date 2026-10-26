"""Local workerd routing fixture; never copied into either production role image."""
import base64
import hashlib
import json
import os
import struct
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *_args):
        pass
    def reply(self, body=b'{}'):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def do_POST(self):
        self.rfile.read(int(self.headers.get('Content-Length', '0')))
        self.reply(json.dumps({'queued': 0, 'running': 0}).encode())
    def do_GET(self):
        if self.headers.get('Upgrade', '').lower() != 'websocket':
            self.reply(json.dumps({'ready': True, 'path': self.path}).encode())
            return
        accept = base64.b64encode(hashlib.sha1((self.headers['Sec-WebSocket-Key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
        self.send_response(101)
        self.send_header('Upgrade', 'websocket')
        self.send_header('Connection', 'Upgrade')
        self.send_header('Sec-WebSocket-Accept', accept)
        if 'quorem' in self.headers.get('Sec-WebSocket-Protocol', ''):
            self.send_header('Sec-WebSocket-Protocol', 'quorem')
        self.end_headers()
        while True:
            header = self.rfile.read(2)
            if len(header) != 2:
                return
            opcode, size = header[0] & 15, header[1] & 127
            if size == 126:
                size = struct.unpack('!H', self.rfile.read(2))[0]
            if size > 4096 or size == 127:
                return
            mask = self.rfile.read(4) if header[1] & 128 else b''
            payload = self.rfile.read(size)
            if mask:
                payload = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
            if opcode == 1 and payload == b'instance':
                payload = os.environ.get('HOSTNAME', 'unknown').encode()
                size = len(payload)
            frame = bytes([128 | (10 if opcode == 9 else opcode)])
            frame += bytes([size]) if size < 126 else bytes([126]) + struct.pack('!H', size)
            self.wfile.write(frame + payload)
            self.wfile.flush()
            if opcode == 8:
                return

for port in (8088, 8090):
    threading.Thread(target=ThreadingHTTPServer(('0.0.0.0', port), Handler).serve_forever, daemon=True).start()
threading.Event().wait()
