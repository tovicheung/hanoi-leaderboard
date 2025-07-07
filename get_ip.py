import socket

s = None
try:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.connect(("8.8.8.8", 80)) # Google
    ip = s.getsockname()[0]
except Exception as e:
    ip = f"Error: {e}"
finally:
    if s:
        s.close()
print(ip)
