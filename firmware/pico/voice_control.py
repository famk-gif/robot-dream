# Voice control for Pico robot (desktop script)
# Requires: Python 3, vosk, sounddevice, pyserial
# Install: pip install vosk sounddevice pyserial
# Usage: python voice_control.py COM3
# Dry run: python voice_control.py --dry-run

import json
import os
import queue
import sys
import time

SERIAL_AVAILABLE = True
try:
    import serial
except Exception:
    SERIAL_AVAILABLE = False

try:
    import sounddevice as sd
    from vosk import Model, KaldiRecognizer
except Exception as exc:
    print("Missing deps. Run: pip install vosk sounddevice")
    raise


# Use a multilingual Vosk model to support Chinese + English.
# Set path via VOSK_MODEL or put model under ./models/vosk
MODEL_PATH = os.environ.get("VOSK_MODEL", os.path.join(os.path.dirname(__file__), "models", "vosk"))

# Optional wake word (set to True to require a wake word)
WAKE_ENABLED = False
WAKE_WORDS = ["robot", "机器人", "小机器人"]

# Command phrases -> serial command
PHRASE_MAP = [
    ("hi", "hi"),
    ("hello", "hi"),
    ("hello robot", "hi"),
    ("你好", "hi"),
    ("嗨", "hi"),
    ("你好机器人", "hi"),

    ("reset", "reset"),
    ("复位", "reset"),
    ("归位", "reset"),

    ("stop", "stop"),
    ("停止", "stop"),
    ("停", "stop"),

    ("left shoulder", "a"),
    ("left arm up", "a"),
    ("left arm", "a"),
    ("左肩", "a"),
    ("左手抬", "a"),

    ("right shoulder", "d"),
    ("right arm up", "d"),
    ("right arm", "d"),
    ("右肩", "d"),
    ("右手抬", "d"),

    ("left elbow", "z"),
    ("left forearm", "z"),
    ("左肘", "z"),
    ("左前臂", "z"),

    ("right elbow", "c"),
    ("right forearm", "c"),
    ("右肘", "c"),
    ("右前臂", "c"),

    ("left gripper", "q"),
    ("left claw", "q"),
    ("左夹爪", "q"),
    ("左手爪", "q"),

    ("right gripper", "e"),
    ("right claw", "e"),
    ("右夹爪", "e"),
    ("右手爪", "e"),

    ("forward", "base forward"),
    ("go forward", "base forward"),
    ("前进", "base forward"),
    ("向前", "base forward"),

    ("back", "base reverse"),
    ("reverse", "base reverse"),
    ("backward", "base reverse"),
    ("后退", "base reverse"),

    ("turn left", "base left"),
    ("left", "base left"),
    ("左转", "base left"),

    ("turn right", "base right"),
    ("right", "base right"),
    ("右转", "base right"),

    ("base stop", "base stop"),
    ("stop base", "base stop"),
    ("停车", "base stop"),
    ("停止底盘", "base stop"),
]


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

    def send(self, text):
        if self.dry_run:
            print(f"[DRY] {text}")
            return
        self.ser.write((text + "\n").encode("utf-8"))

    def close(self):
        try:
            self.ser.close()
        except Exception:
            pass


def normalize(text):
    text = text.lower().strip()
    for ch in [",", "。", "!", "?", ".", "，", "！", "？"]:
        text = text.replace(ch, " ")
    return " ".join(text.split())


def match_command(text):
    for phrase, cmd in PHRASE_MAP:
        if phrase in text:
            return cmd
    return None


def audio_callback(indata, frames, time_info, status):
    if status:
        print(status, file=sys.stderr)
    audio_queue.put(bytes(indata))


def main():
    if len(sys.argv) >= 2 and sys.argv[1].lower() == "--dry-run":
        dry_run = True
        port = None
    elif len(sys.argv) >= 2:
        dry_run = False
        port = sys.argv[1]
    else:
        print("Usage: python voice_control.py COM3")
        print("   or: python voice_control.py --dry-run")
        sys.exit(1)

    if not os.path.isdir(MODEL_PATH):
        print("Vosk model not found.")
        print("Set VOSK_MODEL or place model in:")
        print(f"  {MODEL_PATH}")
        sys.exit(1)

    model = Model(MODEL_PATH)
    rec = KaldiRecognizer(model, 16000)

    sender = Sender(port, dry_run=dry_run)

    print("Voice control ready.")
    print("Speak Chinese or English commands.")
    if WAKE_ENABLED:
        print("Wake word required:", ", ".join(WAKE_WORDS))

    try:
        with sd.RawInputStream(samplerate=16000, blocksize=8000, dtype="int16",
                               channels=1, callback=audio_callback):
            while True:
                data = audio_queue.get()
                if rec.AcceptWaveform(data):
                    result = json.loads(rec.Result())
                    text = normalize(result.get("text", ""))
                    if not text:
                        continue
                    if WAKE_ENABLED:
                        if not any(w in text for w in WAKE_WORDS):
                            continue
                        # remove wake word for cleaner matching
                        for w in WAKE_WORDS:
                            text = text.replace(w, "").strip()
                    cmd = match_command(text)
                    if cmd:
                        sender.send(cmd)
                        print("Heard:", text, "->", cmd)
                    else:
                        print("Heard:", text)
    except KeyboardInterrupt:
        pass
    finally:
        sender.close()


if __name__ == "__main__":
    audio_queue = queue.Queue()
    main()
