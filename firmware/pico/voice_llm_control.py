# Voice + LLM control for Pico robot (desktop script)
# Requires: Python 3, vosk, sounddevice, pyserial, requests
# Install: pip install vosk sounddevice pyserial requests
# Usage: python voice_llm_control.py COM3
# Dry run: python voice_llm_control.py --dry-run

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

try:
    import requests
except Exception as exc:
    print("Missing deps. Run: pip install requests")
    raise


MODEL_PATH = "C:/Users/wangpeng/Desktop/robot/firmware/pico/models/vosk" # os.environ.get("VOSK_MODEL", os.path.join(os.path.dirname(__file__), "models", "vosk"))
LLM_URL = os.environ.get("LLM_URL", "http://localhost:11434/api/chat")
LLM_MODEL = os.environ.get("LLM_MODEL", "qwen3.5:0.8b")

VIRTUAL_ENABLED = os.environ.get("VIRTUAL_ENABLED", "1") != "0"
VIRTUAL_OUT = os.environ.get(
    "VIRTUAL_OUT",
    os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", "runtime", "voice_command.json")
    ),
)
LOG_PATH = os.environ.get(
    "VOICE_LOG",
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "runtime", "voice_log.txt")),
)
LOG_TO_FILE = os.environ.get("VOICE_LOG_FILE", "1") != "0"

WAKE_ENABLED = True
WAKE_WORDS = ["小智同学", "小智同學"]
WAKE_MAX_EDIT = 2

ALLOWED = {
    "hi",
    "reset",
    "stop",
    "a",
    "d",
    "z",
    "c",
    "q",
    "e",
    "base forward",
    "base reverse",
    "base left",
    "base right",
    "base stop",
    "base speed",
    "base turn",
}

ALIASES = {
    "hi": ["你好", "您好", "哈喽", "嗨", "hello", "hi", "挥手", "打招呼", "问好"],
    "reset": ["复位", "回中", "回正", "归位", "回到初始", "回到初始位", "reset"],
    "stop": ["停", "停止", "停下", "停住", "别动", "stop", "pause", "暂停"],
    "base forward": ["前进", "向前", "往前", "forward"],
    "base reverse": ["后退", "向后", "后面", "reverse", "backward"],
    "base left": ["左转", "向左转", "往左", "turn left", "left"],
    "base right": ["右转", "向右转", "往右", "turn right", "right"],
    "a": ["抬左手", "左手抬", "左臂抬", "左肩"],
    "d": ["抬右手", "右手抬", "右臂抬", "右肩"],
    "z": ["左肘", "左手肘"],
    "c": ["右肘", "右手肘"],
    "q": ["左夹爪", "左抓", "左手抓", "左钳"],
    "e": ["右夹爪", "右抓", "右手抓", "右钳"],
}

ALIAS_LIST = sorted(
    [(phrase, cmd) for cmd, phrases in ALIASES.items() for phrase in phrases],
    key=lambda item: len(item[0]),
    reverse=True,
)

GREET_WORDS = ["你好", "您好", "哈喽", "嗨", "hello", "hi", "挥手", "打招呼", "问好"]
ARM_WORDS = ["手", "手臂", "胳膊", "肩", "肘", "夹爪", "抓", "钳"]

SYSTEM_PROMPT = (
    "你是机器人指令解析器，只能输出以下命令，不能输出任何解释："
    "hi, reset, stop, a, d, z, c, q, e, "
    "base forward, base reverse, base left, base right, base stop, "
    "base speed <0.1-1.0>, base turn <0.1-1.0>。"
    "如果一句话有多个动作，按顺序分多行输出。"
    "规则："
    "1) 问候词（你好/您好/hi/hello/挥手/打招呼/问好）必须输出 hi，且不要输出手臂/夹爪指令。"
    "2) 说前进/后退/左转/右转/转向且未提到手臂/手/肩/肘/夹爪时，输出底盘命令。"
    "3) 提到手臂：左肩->a，右肩->d，左肘->z，右肘->c，左夹爪->q，右夹爪->e。"
    "4) 不清楚就输出 stop。"
    "例子："
    "“前进”-> base forward；“向左转”-> base left；“抬左手”-> a；“右肘弯一点”-> c。"
)


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
    for ch in [",", "。", "!", "?", ".", "，", "！", "？", "\n", "\r", "\t"]:
        text = text.replace(ch, " ")
    return " ".join(text.split())


def edit_distance(a, b):
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cost = 0 if ca == cb else 1
            cur.append(min(
                prev[j] + 1,
                cur[j - 1] + 1,
                prev[j - 1] + cost
            ))
        prev = cur
    return prev[-1]


def is_wake_word(text):
    compact = text.replace(" ", "")
    for w in WAKE_WORDS:
        idx = compact.find(w)
        if idx != -1:
            return True, compact, (idx, idx + len(w))
    for w in WAKE_WORDS:
        wlen = len(w)
        if wlen == 0:
            continue
        for start in range(0, max(0, len(compact) - wlen + 1)):
            window = compact[start:start + wlen]
            if edit_distance(window, w) <= WAKE_MAX_EDIT:
                return True, compact, (start, start + wlen)
    return False, compact, None


def extract_command(text):
    text = normalize(text)
    if not text:
        return None
    # Exact match
    if text in ALLOWED:
        return text
    # Alias match (common phrases)
    for phrase, cmd in ALIAS_LIST:
        if phrase in text:
            return cmd
    # Handle base speed/turn with value
    if text.startswith("base speed") or text.startswith("base turn"):
        return text
    # Try to find a known command as substring
    for cmd in sorted(ALLOWED, key=len, reverse=True):
        if cmd in text:
            return cmd
    return None


def extract_commands(text, limit=4):
    if not text:
        return []
    # Preserve newlines from LLM output
    text = text.replace("\r", "\n")
    for sep in [";", "；", "、", "|", "，", ","]:
        text = text.replace(sep, "\n")
    parts = [p.strip() for p in text.split("\n") if p.strip()]
    cmds = []
    for part in parts:
        cmd = extract_command(part)
        if cmd:
            cmds.append(cmd)
        if len(cmds) >= limit:
            break
    return cmds


def apply_greeting_override(user_text, cmds):
    if not cmds:
        return cmds
    text = normalize(user_text)
    if not text:
        return cmds
    has_greet = any(word in text for word in GREET_WORDS)
    has_arm = any(word in text for word in ARM_WORDS)
    if has_greet and not has_arm:
        if all(cmd in {"a", "d", "z", "c", "q", "e"} for cmd in cmds):
            return ["hi"]
    return cmds


def evidence_from_text(user_text):
    text = normalize(user_text)
    found = []
    if not text:
        return set()
    for phrase, cmd in ALIAS_LIST:
        if phrase in text:
            found.append(cmd)
    return set(found)


def call_llm(user_text):
    payload = {
        "model": LLM_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_text},
        ],
        "think": False,
        "stream": False,
    }
    resp = requests.post(LLM_URL, json=payload, timeout=60)
    resp.raise_for_status()
    data = resp.json()
    return data["message"]["content"]

def write_virtual(seq, cmds):
    if not VIRTUAL_ENABLED:
        return
    try:
        os.makedirs(os.path.dirname(VIRTUAL_OUT), exist_ok=True)
        payload = {"seq": seq, "ts": time.time(), "cmds": cmds}
        with open(VIRTUAL_OUT, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
    except Exception:
        pass


def log_line(msg):
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    if LOG_TO_FILE:
        try:
            os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
            with open(LOG_PATH, "a", encoding="utf-8") as f:
                f.write(line + "\n")
        except Exception:
            pass


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
        print("Usage: python voice_llm_control.py COM3")
        print("   or: python voice_llm_control.py --dry-run")
        sys.exit(1)

    if not os.path.isdir(MODEL_PATH):
        print("Vosk model not found.")
        print("Set VOSK_MODEL or place model in:")
        print(f"  {MODEL_PATH}")
        sys.exit(1)

    model = Model(MODEL_PATH)
    rec = KaldiRecognizer(model, 16000)

    sender = Sender(port, dry_run=dry_run)

    print("Voice + LLM control ready.")
    print("Speak Chinese or English commands.")
    if WAKE_ENABLED:
        print("Wake word required:", ", ".join(WAKE_WORDS))

    last_cmd = None
    last_time = 0.0
    seq = 0

    try:
        with sd.RawInputStream(samplerate=16000, blocksize=8000, dtype="int16",
                               channels=1, callback=audio_callback):
            while True:
                data = audio_queue.get()
                if rec.AcceptWaveform(data):
                    result = json.loads(rec.Result())
                    raw_text = normalize(result.get("text", ""))
                    if not raw_text:
                        continue
                    log_line(f"Heard: {raw_text}")
                    if WAKE_ENABLED:
                        ok, compact, span = is_wake_word(raw_text)
                        if not ok:
                            log_line("Wake: no-match")
                            continue
                        log_line(f"Wake: match span={span} compact={compact}")
                        if span:
                            text = compact[span[1]:].strip()
                        else:
                            text = compact.strip()
                    else:
                        text = raw_text
                    if not text:
                        log_line("Parse: empty-after-wake")
                        continue
                    try:
                        log_line(f"LLM in: {text}")
                        llm_out = call_llm(text)
                    except Exception as exc:
                        log_line(f"LLM error: {exc}")
                        continue
                    log_line(f"LLM out: {llm_out}")
                    cmds = extract_commands(llm_out)
                    log_line(f"Cmds raw: {cmds}")
                    cmds = apply_greeting_override(text, cmds)
                    evidence = evidence_from_text(text)
                    if evidence:
                        cmds = [
                            cmd for cmd in cmds
                            if cmd in evidence or cmd.startswith("base speed") or cmd.startswith("base turn")
                        ]
                        log_line(f"Evidence: {sorted(evidence)}")
                    log_line(f"Cmds final: {cmds}")
                    if not cmds:
                        log_line(f"No command. Text: {text} -> LLM: {llm_out}")
                        continue
                    now = time.time()
                    # Basic de-duplication for repeated single commands
                    if len(cmds) == 1 and cmds[0] == last_cmd and (now - last_time) < 0.6:
                        continue
                    for cmd in cmds:
                        sender.send(cmd)
                        time.sleep(0.06)
                    seq += 1
                    write_virtual(seq, cmds)
                    last_cmd = cmds[-1]
                    last_time = now
                    if WAKE_ENABLED:
                        log_line("Action: " + ", ".join(cmds))
                    else:
                        log_line("Action: " + ", ".join(cmds))
    except KeyboardInterrupt:
        pass
    finally:
        sender.close()


if __name__ == "__main__":
    audio_queue = queue.Queue()
    main()
