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

# Exact phrases -> serial command (fast path)
PHRASE_MAP = [
    ("hello robot", "hi"),
    ("你好机器人", "hi"),
    ("reset", "reset"),
    ("复位", "reset"),
    ("归位", "reset"),
    ("stop base", "base stop"),
    ("base stop", "base stop"),
]

# Natural language keywords (Chinese + English)
WORDS = {
    "hi": ["hi", "hello", "wave", "你好", "嗨", "打招呼", "挥手"],
    "reset": ["reset", "复位", "归位", "回位", "回中"],
    "stop": ["stop", "停止", "停"],
    "base": ["base", "底盘", "轮子", "车", "移动", "行走"],
    "forward": ["forward", "go forward", "ahead", "前进", "向前", "往前"],
    "back": ["back", "reverse", "backward", "后退", "向后", "往后"],
    "left": ["left", "左", "左边", "左侧"],
    "right": ["right", "右", "右边", "右侧"],
    "turn": ["turn", "rotate", "转", "转向"],
    "arm": ["arm", "hand", "手", "手臂", "胳膊"],
    "shoulder": ["shoulder", "肩", "肩部"],
    "elbow": ["elbow", "肘", "肘部", "前臂"],
    "gripper": ["gripper", "claw", "夹爪", "爪", "手爪"],
    "both": ["both", "two", "双", "两", "左右", "两只"],
    "more": ["more", "again", "再", "多", "更多", "多点", "多一点"],
    "little": ["a little", "slightly", "一点", "点点", "少量"],
    "much": ["a lot", "much", "很多", "大幅", "大一点"],
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


def contains_any(text, words):
    return any(w in text for w in words)


def intensity(text):
    if contains_any(text, WORDS["much"]):
        return 5
    if contains_any(text, WORDS["more"]):
        return 3
    if contains_any(text, WORDS["little"]):
        return 1
    return 2


def match_command(text):
    for phrase, cmd in PHRASE_MAP:
        if phrase in text:
            return cmd
    return None


def parse_intent(text):
    # High priority intents
    if contains_any(text, WORDS["reset"]):
        return [("reset", 1)]
    if contains_any(text, WORDS["hi"]):
        return [("hi", 1)]

    # Stop intent
    if contains_any(text, WORDS["stop"]):
        if contains_any(text, WORDS["base"]) or contains_any(text, WORDS["turn"]):
            return [("base stop", 1)]
        return [("stop", 1)]

    # Base intent
    base_hint = contains_any(text, WORDS["base"]) or contains_any(text, WORDS["turn"])
    if base_hint or contains_any(text, WORDS["forward"]) or contains_any(text, WORDS["back"]):
        if contains_any(text, WORDS["forward"]):
            return [("base forward", 1)]
        if contains_any(text, WORDS["back"]):
            return [("base reverse", 1)]
        if contains_any(text, WORDS["left"]):
            return [("base left", 1)]
        if contains_any(text, WORDS["right"]):
            return [("base right", 1)]

    # Arm intent
    arm_hint = contains_any(text, WORDS["arm"]) or contains_any(text, WORDS["shoulder"]) \
        or contains_any(text, WORDS["elbow"]) or contains_any(text, WORDS["gripper"])
    if arm_hint:
        side_left = contains_any(text, WORDS["left"])
        side_right = contains_any(text, WORDS["right"])
        side_both = contains_any(text, WORDS["both"])

        # Default joint if only "arm/hand"
        joint = "shoulder"
        if contains_any(text, WORDS["elbow"]):
            joint = "elbow"
        elif contains_any(text, WORDS["gripper"]):
            joint = "gripper"
        elif contains_any(text, WORDS["shoulder"]):
            joint = "shoulder"

        count = intensity(text)

        def joint_cmd(side):
            if joint == "shoulder":
                return "a" if side == "left" else "d"
            if joint == "elbow":
                return "z" if side == "left" else "c"
            return "q" if side == "left" else "e"

        cmds = []
        if side_both:
            cmds.append((joint_cmd("left"), count))
            cmds.append((joint_cmd("right"), count))
        elif side_left and not side_right:
            cmds.append((joint_cmd("left"), count))
        elif side_right and not side_left:
            cmds.append((joint_cmd("right"), count))
        else:
            # Default: right side if not specified
            cmds.append((joint_cmd("right"), count))
        return cmds

    return []


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
                        continue
                    intents = parse_intent(text)
                    if intents:
                        for cmd_text, count in intents:
                            for _ in range(max(1, count)):
                                sender.send(cmd_text)
                                time.sleep(0.04)
                        print("Heard:", text, "->", ", ".join([f\"{c}*{n}\" for c, n in intents]))
                    else:
                        print("Heard:", text)
    except KeyboardInterrupt:
        pass
    finally:
        sender.close()


if __name__ == "__main__":
    audio_queue = queue.Queue()
    main()
