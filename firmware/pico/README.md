# Pico 舵机控制程序（真实硬件可跑）

## 1. 准备
1. 给 Pico 刷入 MicroPython 固件（.uf2）。
2. 用 Thonny 或 mpremote 连接 Pico。
3. 将 `main.py` 复制到 Pico 根目录。

## 2. 接线
- 舵机电源：6V 10A
- Pico：USB 5V
- 必须共地（Pico GND 接舵机电源 GND）

GPIO 线序：
1. GPIO2 -> 左肩 MG996R
2. GPIO3 -> 左肘 MG996R
3. GPIO4 -> 左夹爪 MG90S
4. GPIO5 -> 右肩 MG996R
5. GPIO6 -> 右肘 MG996R
6. GPIO7 -> 右夹爪 MG90S

## 3. 串口控制指令
在串口里输入并回车：
- `a` 左肩前抬
- `d` 右肩前抬
- `z` 左肘弯折
- `c` 右肘弯折
- `q` 左夹爪开合
- `e` 右夹爪开合
- `hi` 右手挥手
- `reset` 复位
- `stop` 立即停在当前姿态

## 4. 校准（必要时）
如果舵机方向相反或行程不对：
- 在 `main.py` 中修改 `invert=True/False`
- 或修改 `servo_min` / `servo_max`

## 5. 注意
- 不要从 Pico 直接给舵机供电。
- 先单个舵机测试，再逐个接入。

## 6. 键盘控制脚本
1. 安装 pyserial：pip install pyserial
2. 运行脚本：python keyboard_control.py COM3
3. 按键：a d z c q e（按住移动，松开即停）/ h / r / s
4. 无硬件演示：python keyboard_control.py --dry-run（只打印指令，不发串口）
