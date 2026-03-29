# Pico 舵机 + 底盘控制程序（真实硬件可跑）

## 1. 准备
1. 给 Pico 刷入 MicroPython 固件（.uf2）。
2. 用 Thonny 或 mpremote 连接 Pico。
3. 将 `main.py` 复制到 Pico 根目录。

## 2. 接线
- 舵机电源：6V 10A
- Pico：USB 5V
- 必须共地（Pico GND 接舵机电源 GND）

GPIO 线序（舵机）：
1. GPIO2 -> 左肩 MG996R
2. GPIO3 -> 左肘 MG996R
3. GPIO4 -> 左夹爪 MG90S
4. GPIO5 -> 右肩 MG996R
5. GPIO6 -> 右肘 MG996R
6. GPIO7 -> 右夹爪 MG90S

底盘驱动（TB6612FNG，可选）：
- STBY -> GPIO8
- AIN1 -> GPIO9
- AIN2 -> GPIO10
- PWMA -> GPIO11
- BIN1 -> GPIO12
- BIN2 -> GPIO13
- PWMB -> GPIO14
- VM -> 电机电源（如 6V 或 2S 电池）
- VCC -> Pico 3.3V
- GND -> 共地
- A01/A02 -> 左电机
- B01/B02 -> 右电机

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

底盘指令：
- `base forward` 前进
- `base reverse` 后退
- `base left` 原地左转
- `base right` 原地右转
- `base stop` 停止底盘
- `base speed 0.6` 设置直行速度（0.1~1.0）
- `base turn 0.6` 设置转向速度（0.1~1.0）

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
3. 按键：
   - 舵机：a d z c q e（按住移动，松开即停）
   - 底盘：方向键（前进/后退/左转/右转）
   - 其它：h / r / s / x（base stop）
4. 无硬件演示：python keyboard_control.py --dry-run（只打印指令，不发串口）
## 7. 语音控制（电脑端）
1. 安装依赖：pip install vosk sounddevice pyserial
2. 下载一个支持中英文的 Vosk 模型，并放到：
   firmware/pico/models/vosk
   或设置环境变量 VOSK_MODEL 指向模型目录。
3. 运行：python voice_control.py COM3
4. 无硬件演示：python voice_control.py --dry-run

语音示例：
- “你好 / hello / 挥手” -> hi
- “帮我抬左手 / left arm up” -> a
- “右肘 / right elbow” -> c
- “前进 / 向前 / forward” -> base forward
- “停 / 停止 / stop” -> stop
- “向左转 / turn left” -> base left

自然语言小技巧：
1. 不说专业词也可以，例如“抬左手”“右肘弯一点”“向前走”。  
2. 说“再/多一点”会多执行几步；说“很多/大一点”会执行更多步。  
3. 未说明左右时默认右侧。  

可选：将 `WAKE_ENABLED = True` 打开后，需要说“robot / 机器人”作为唤醒词。

## 8. 语音 + LLM 控制（电脑端）
1. 安装依赖：pip install vosk sounddevice pyserial requests
2. 下载一个支持中英文的 Vosk 模型，并放到：
   firmware/pico/models/vosk
   或设置环境变量 VOSK_MODEL 指向模型目录。
3. 本地 LLM 使用 Ollama 风格接口：
   - URL: http://localhost:11434/api/chat
   - 模型：qwen3.5:0.8b（可用 LLM_MODEL 环境变量替换）
4. 运行：python voice_llm_control.py COM3
5. 无硬件演示：python voice_llm_control.py --dry-run

说明：
- 语音识别到文本后，会调用本地 LLM 输出“动作命令”。
- LLM 只允许输出：hi / reset / stop / a d z c q e / base forward/reverse/left/right/stop。
- 默认去抖，避免连续重复触发。
- 如需修改接口地址：设置 LLM_URL 环境变量。
- 现在需要唤醒词：必须包含“`小智同学`”才会执行（只解析唤醒词后面的语句）。
- 支持轻微识别误差（如同音字），会尝试模糊匹配唤醒词。
- 若 LLM 输出非标准命令，会使用关键词做兜底映射（如“你好/挥手”-> hi）。

多动作支持：
- 如果一句话里有多个动作，LLM 会输出多行命令，脚本会按顺序执行。
- 示例：\"前进 然后 后退 再 左转\" -> base forward / base reverse / base left

## 9. 虚拟网页联动（可选）
1. 启动本地网页：python -m http.server 8123
2. 浏览器打开：http://localhost:8123/robot-virtual.html
3. 运行：python voice_llm_control.py --dry-run

说明：
- 脚本会写入 `runtime/voice_command.json`，网页每 200ms 轮询并触发动作。
- 关闭联动：设置 `VIRTUAL_ENABLED=0`
- 自定义输出位置：设置 `VIRTUAL_OUT` 为完整文件路径
