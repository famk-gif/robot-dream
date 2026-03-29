# Pico servo controller (MicroPython)
# 6 servos: left/right shoulder, left/right elbow, left/right gripper
# USB serial commands: a d z c q e hi reset stop

import sys
import time
try:
    import uselect  # MicroPython only
    from machine import Pin, PWM  # MicroPython only
except Exception:
    # Stubs for editor/linting on desktop Python
    uselect = None

    class Pin:
        OUT = 0

        def __init__(self, *args, **kwargs):
            pass

        def value(self, *args, **kwargs):
            return 0

    class PWM:
        def __init__(self, *args, **kwargs):
            pass

        def freq(self, *args, **kwargs):
            pass

        def duty_u16(self, *args, **kwargs):
            pass


def clamp(value, lo, hi):
    return lo if value < lo else hi if value > hi else value


def approach(current, target, max_delta):
    if abs(target - current) <= max_delta:
        return target
    return current + (max_delta if target > current else -max_delta)


class Servo:
    def __init__(self, pin, min_us=500, max_us=2500, freq=50):
        self.pwm = PWM(Pin(pin))
        self.pwm.freq(freq)
        self.min_us = min_us
        self.max_us = max_us
        self.freq = freq
        self.last_us = None

    def write_us(self, us):
        us = clamp(us, self.min_us, self.max_us)
        if self.last_us == us:
            return
        duty = int(us * 65535 * self.freq / 1_000_000)
        self.pwm.duty_u16(duty)
        self.last_us = us


class Joint:
    def __init__(self, name, pin, angle_min, angle_max, angle_init, servo_min, servo_max, speed, accel, invert=False):
        self.name = name
        self.angle_min = angle_min
        self.angle_max = angle_max
        self.angle = angle_init
        self.target = angle_init
        self.speed = 0.0
        self.max_speed = speed
        self.accel = accel
        self.invert = invert
        self.servo = Servo(pin)
        self.servo_min = servo_min
        self.servo_max = servo_max

    def map_to_servo(self, angle):
        angle = clamp(angle, self.angle_min, self.angle_max)
        t = (angle - self.angle_min) / (self.angle_max - self.angle_min)
        if self.invert:
            t = 1.0 - t
        return self.servo_min + t * (self.servo_max - self.servo_min)

    def update(self, dt):
        delta = self.target - self.angle
        if abs(delta) < 0.001:
            self.speed = 0.0
            self.angle = self.target
        else:
            desired = clamp(delta / dt, -self.max_speed, self.max_speed)
            self.speed = approach(self.speed, desired, self.accel * dt)
            next_angle = self.angle + self.speed * dt
            if (self.target - self.angle) * (self.target - next_angle) <= 0:
                next_angle = self.target
                self.speed = 0.0
            self.angle = clamp(next_angle, self.angle_min, self.angle_max)

        us = self.map_to_servo(self.angle)
        self.servo.write_us(us)


# Base drive (TB6612FNG or similar)
BASE_ENABLED = True
BASE_SPEED = 0.55
TURN_SPEED = 0.55

# TB6612FNG pins (Pico GPIO). Change if you wire differently.
BASE_STBY = 8
BASE_AIN1 = 9
BASE_AIN2 = 10
BASE_PWMA = 11
BASE_BIN1 = 12
BASE_BIN2 = 13
BASE_PWMB = 14


class DCMotor:
    def __init__(self, in1, in2, pwm_pin, freq=1200):
        self.in1 = Pin(in1, Pin.OUT)
        self.in2 = Pin(in2, Pin.OUT)
        self.pwm = PWM(Pin(pwm_pin))
        self.pwm.freq(freq)
        self.speed = 0.0
        self.set(0.0)

    def set(self, value):
        value = clamp(value, -1.0, 1.0)
        if abs(value) < 0.001:
            self.in1.value(0)
            self.in2.value(0)
            self.pwm.duty_u16(0)
            self.speed = 0.0
            return
        if value > 0:
            self.in1.value(1)
            self.in2.value(0)
        else:
            self.in1.value(0)
            self.in2.value(1)
        duty = int(abs(value) * 65535)
        self.pwm.duty_u16(duty)
        self.speed = value


class BaseDrive:
    def __init__(self, enabled=True):
        self.enabled = enabled
        self.base_speed = BASE_SPEED
        self.turn_speed = TURN_SPEED
        if not enabled:
            self.left = None
            self.right = None
            return
        self.stby = Pin(BASE_STBY, Pin.OUT)
        self.stby.value(1)
        self.left = DCMotor(BASE_AIN1, BASE_AIN2, BASE_PWMA)
        self.right = DCMotor(BASE_BIN1, BASE_BIN2, BASE_PWMB)

    def stop(self):
        if not self.enabled:
            return
        self.left.set(0.0)
        self.right.set(0.0)

    def forward(self):
        if not self.enabled:
            return
        self.left.set(self.base_speed)
        self.right.set(self.base_speed)

    def reverse(self):
        if not self.enabled:
            return
        self.left.set(-self.base_speed)
        self.right.set(-self.base_speed)

    def turn_left(self):
        if not self.enabled:
            return
        self.left.set(-self.turn_speed)
        self.right.set(self.turn_speed)

    def turn_right(self):
        if not self.enabled:
            return
        self.left.set(self.turn_speed)
        self.right.set(-self.turn_speed)

    def set_speed(self, value):
        self.base_speed = clamp(value, 0.1, 1.0)

    def set_turn_speed(self, value):
        self.turn_speed = clamp(value, 0.1, 1.0)


base_drive = BaseDrive(enabled=BASE_ENABLED)


# Joint config (angles in degrees, speeds in deg/s, accel in deg/s^2)
# Tuned for more human-like motion (slower, smoother)
SHOULDER_SPEED = 70
SHOULDER_ACCEL = 160
ELBOW_SPEED = 85
ELBOW_ACCEL = 180
GRIPPER_SPEED = 120
GRIPPER_ACCEL = 260
JOINTS = {
    "left_shoulder": Joint("left_shoulder", 2, -10, 65, 0, 600, 2400, SHOULDER_SPEED, SHOULDER_ACCEL, invert=False),
    "right_shoulder": Joint("right_shoulder", 5, -10, 65, 0, 600, 2400, SHOULDER_SPEED, SHOULDER_ACCEL, invert=True),
    "left_elbow": Joint("left_elbow", 3, 5, 120, 5, 600, 2400, ELBOW_SPEED, ELBOW_ACCEL, invert=False),
    "right_elbow": Joint("right_elbow", 6, 5, 120, 5, 600, 2400, ELBOW_SPEED, ELBOW_ACCEL, invert=True),
    "left_gripper": Joint("left_gripper", 4, 0, 30, 10, 700, 2300, GRIPPER_SPEED, GRIPPER_ACCEL, invert=False),
    "right_gripper": Joint("right_gripper", 7, 0, 30, 10, 700, 2300, GRIPPER_SPEED, GRIPPER_ACCEL, invert=True),
}

KEYMAP = {
    "a": ("left_shoulder", 1.0),
    "d": ("right_shoulder", 1.0),
    "z": ("left_elbow", 1.5),
    "c": ("right_elbow", 1.5),
    "q": ("left_gripper", 1.0),
    "e": ("right_gripper", 1.0),
}

BASEMAP = {
    "i": "forward",
    "k": "reverse",
    "j": "left",
    "l": "right",
    "x": "stop",
}


# Wave gesture sequence (ms, shoulder, elbow, gripper)
WAVE_FRAMES = [
    (0, 0, 5, 10),
    (1400, 58, 55, 14),
    (2050, 58, 80, 14),
    (2700, 58, 35, 14),
    (3350, 58, 80, 14),
    (4000, 58, 55, 14),
    (5400, 0, 5, 10),
]


class Wave:
    def __init__(self):
        self.active = False
        self.start = 0
        self.snapshot = None

    def begin(self):
        self.snapshot = {k: j.target for k, j in JOINTS.items()}
        self.start = time.ticks_ms()
        self.active = True

    def stop(self):
        if not self.active:
            return
        if self.snapshot:
            for k, v in self.snapshot.items():
                JOINTS[k].target = v
        self.active = False
        self.snapshot = None

    def update(self):
        if not self.active:
            return
        elapsed = time.ticks_diff(time.ticks_ms(), self.start)
        if elapsed >= WAVE_FRAMES[-1][0]:
            self.stop()
            return
        for i in range(len(WAVE_FRAMES) - 1):
            t0, s0, e0, g0 = WAVE_FRAMES[i]
            t1, s1, e1, g1 = WAVE_FRAMES[i + 1]
            if t0 <= elapsed <= t1:
                t = (elapsed - t0) / max(1, (t1 - t0))
                JOINTS["right_shoulder"].target = s0 + (s1 - s0) * t
                JOINTS["right_elbow"].target = e0 + (e1 - e0) * t
                JOINTS["right_gripper"].target = g0 + (g1 - g0) * t
                break


wave = Wave()


def reset_pose():
    for j in JOINTS.values():
        j.target = j.angle_min if j.name.endswith("elbow") else j.target
    JOINTS["left_shoulder"].target = 0
    JOINTS["right_shoulder"].target = 0
    JOINTS["left_elbow"].target = 5
    JOINTS["right_elbow"].target = 5
    JOINTS["left_gripper"].target = 10
    JOINTS["right_gripper"].target = 10
    base_drive.stop()


# 命令入口：处理单条指令（如 a / hi / base forward）
def apply_key(key):
    key = key.lower()
    if key == "hi":
        wave.begin()
        return
    if key == "reset":
        wave.stop()
        reset_pose()
        return
    if key == "stop":
        wave.stop()
        # Hold current pose immediately (stop moving toward any target)
        for j in JOINTS.values():
            j.target = j.angle
        base_drive.stop()
        return
    if key in BASEMAP:
        action = BASEMAP[key]
        if action == "forward":
            base_drive.forward()
        elif action == "reverse":
            base_drive.reverse()
        elif action == "left":
            base_drive.turn_left()
        elif action == "right":
            base_drive.turn_right()
        elif action == "stop":
            base_drive.stop()
        return
    if key in KEYMAP:
        joint_name, step = KEYMAP[key]
        j = JOINTS[joint_name]
        j.target = clamp(j.target + step, j.angle_min, j.angle_max)


# 命令入口：处理串口收到的一整行
def apply_line(line):
    if not line:
        return
    parts = line.strip().split()
    if len(parts) == 1:
        apply_key(parts[0])
        return
    if parts[0] == "base":
        if len(parts) == 2:
            cmd = parts[1]
            if cmd == "forward":
                base_drive.forward()
            elif cmd == "reverse":
                base_drive.reverse()
            elif cmd == "left":
                base_drive.turn_left()
            elif cmd == "right":
                base_drive.turn_right()
            elif cmd == "stop":
                base_drive.stop()
        elif len(parts) == 3:
            cmd = parts[1]
            try:
                value = float(parts[2])
            except Exception:
                return
            if cmd == "speed":
                base_drive.set_speed(value)
            elif cmd == "turn":
                base_drive.set_turn_speed(value)
        return
    if parts[0] == "set" and len(parts) == 3:
        name = parts[1]
        try:
            value = float(parts[2])
        except Exception:
            return
        if name in JOINTS:
            j = JOINTS[name]
            j.target = clamp(value, j.angle_min, j.angle_max)
        return


# 串口读取 + 动作更新主循环（执行出口）
poll = uselect.poll()
poll.register(sys.stdin, uselect.POLLIN)
rx_buf = ""

last = time.ticks_ms()
reset_pose()

while True:
    now = time.ticks_ms()
    dt = max(0.001, time.ticks_diff(now, last) / 1000)
    last = now

    if poll.poll(0):
        data = sys.stdin.read(32)
        if data:
            rx_buf += data
            while "\n" in rx_buf:
                line, rx_buf = rx_buf.split("\n", 1)
                apply_line(line.strip())

    wave.update()

    for j in JOINTS.values():
        j.update(dt)

    time.sleep_ms(20)
