# Pico 电控程序说明

文件位置：
- firmware/pico/main.py
- firmware/pico/README.md

功能：
1. 6 路舵机控制（肩、肘、夹爪）。
2. 底盘双电机控制（可选，TB6612FNG）。
3. 通过 USB 串口输入按键指令。
4. 支持 `hi` 挥手动作。
5. 支持速度与加速度限制，动作更接近人手。

关键指令（串口）：
- a d z c q e：舵机单步
- hi / reset / stop
- base forward / reverse / left / right / stop
- base speed 0.6 / base turn 0.6

键盘脚本（电脑端）：
- 舵机：a d z c q e
- 底盘：方向键
- 其它：h / r / s / x

键位图：
![键位图](assets/keymap.svg)

动作脚本：
- `main.py` 中的 `WAVE_FRAMES` 定义挥手动作。
- 每一帧格式：`(毫秒, 肩角度, 肘角度, 夹爪角度)`
- 你可以追加或修改帧来做“敬礼 / 点头 / 伸手”等动作。
