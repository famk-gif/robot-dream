# Keyboard controller for Pico servo robot
# Requires: Python 3, pyserial
# Install: pip install pyserial
# Usage: python keyboard_control.py COM3

import sys
import time
import threading

SERIAL_AVAILABLE = True
try:
    import serial
except Exception:
    SERIAL_AVAILABLE = False

try:
    import msvcrt
except Exception as exc:
    print("This script requires Windows (msvcrt).")
    raise


KEYMAP = {
    'a': 'a',
    'd': 'd',
    'z': 'z',
    'c': 'c',
    'q': 'q',
    'e': 'e',
}

SPECIAL = {
    'h': 'hi',
    'r': 'reset',
    's': 'stop',
}


class Sender:
    def __init__(self, port, baud=115200, dry_run=False):
        self.port = port
        self.baud = baud
        self.dry_run = dry_run
        self.ser = None
        if not self.dry_run:
            if not SERIAL_AVAILABLE:
                print("pyserial not installed. Run: pip install pyserial")
                raise RuntimeError("pyserial missing")
            self.ser = serial.Serial(port, baudrate=baud, timeout=0.1)
            time.sleep(0.5)
        self.lock = threading.Lock()

    def send(self, text):
        with self.lock:
            if self.dry_run:
                print(f"[DRY] {text}")
                return
            self.ser.write((text + "\n").encode("utf-8"))

    def close(self):
        try:
            self.ser.close()
        except Exception:
            pass


STOP_TIMEOUT_S = 0.2


def print_help(dry_run):
    print("Keyboard control ready:")
    print("  a d z c q e  -> hold to move, release to stop")
    print("  arrow keys   -> base forward/reverse/left/right")
    print("  h -> hi (wave)")
    print("  r -> reset")
    print("  s -> stop")
    print("  x -> base stop")
    print("  ESC -> exit")
    print("  Tip: press arrow keys to test base control")
    if dry_run:
        print("  DRY RUN: commands are printed, no serial output")


def main():
    dry_run = False
    port = None

    if len(sys.argv) >= 2 and sys.argv[1].lower() == "--dry-run":
        dry_run = True
    elif len(sys.argv) >= 2:
        port = sys.argv[1]
    else:
        print("Usage: python keyboard_control.py COM3")
        print("   or: python keyboard_control.py --dry-run")
        sys.exit(1)

    sender = Sender(port, dry_run=dry_run)
    print_help(dry_run)

    last_move_time = 0.0
    stop_sent = False

    try:
        while True:
            now = time.time()
            if msvcrt.kbhit():
                ch = msvcrt.getch()
                if ch in (b'\x1b',):
                    break
                if ch in (b'\xe0', b'\x00'):
                    arrow = msvcrt.getch()
                    if arrow == b'H':  # up
                        sender.send('base forward')
                        last_move_time = now
                        stop_sent = False
                    elif arrow == b'P':  # down
                        sender.send('base reverse')
                        last_move_time = now
                        stop_sent = False
                    elif arrow == b'K':  # left
                        sender.send('base left')
                        last_move_time = now
                        stop_sent = False
                    elif arrow == b'M':  # right
                        sender.send('base right')
                        last_move_time = now
                        stop_sent = False
                    continue
                try:
                    key = ch.decode('utf-8').lower()
                except Exception:
                    continue

                if key in KEYMAP:
                    sender.send(KEYMAP[key])
                    last_move_time = now
                    stop_sent = False
                elif key in SPECIAL:
                    sender.send(SPECIAL[key])
                    last_move_time = 0.0
                    stop_sent = False
                elif key == 'x':
                    sender.send('base stop')
                    last_move_time = 0.0
                    stop_sent = False

            if last_move_time > 0.0 and not stop_sent and (now - last_move_time) > STOP_TIMEOUT_S:
                sender.send("stop")
                stop_sent = True
                last_move_time = 0.0

            time.sleep(0.01)
    finally:
        sender.close()


if __name__ == '__main__':
    main()
