#!/usr/bin/env python3
import os
import socket
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


def lan_ip():
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.connect(("8.8.8.8", 80))
        ip = sock.getsockname()[0]
        sock.close()
        return ip
    except OSError:
        return "本机"


def main():
    root = os.path.dirname(os.path.abspath(__file__))
    os.chdir(root)
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    server = ThreadingHTTPServer(("0.0.0.0", port), NoCacheHandler)
    ip = lan_ip()
    print(f"晚灯已打开： http://127.0.0.1:{port}/?v=7")
    print(f"手机请用这个（关掉旧标签再开）： http://{ip}:{port}/?v=7")
    print("同一 Wi-Fi 下才打得开。酒店网络有时会隔离手机和电脑。")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已关闭")


if __name__ == "__main__":
    main()
