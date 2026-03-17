import { robotConfig } from '../config/robotConfig.js';
import { createRobotScene } from '../components/robotScene.js';
import { createControlPanel } from '../components/controlPanel.js';

const stage = document.querySelector('#robot-stage');
const panel = document.querySelector('#control-panel');
const baseStatus = document.querySelector('#base-status');
const resetStatus = document.querySelector('#reset-status');

const state = createInitialState(robotConfig.limits);
const scene = createRobotScene(stage, state);
const controls = createControlPanel(panel, robotConfig);

const pressedKeys = new Set();
let resetTimer = null;
let animationFrame = null;

render();
window.addEventListener('keydown', handleKeyDown);
window.addEventListener('keyup', handleKeyUp);
window.addEventListener('blur', clearPressedKeys);
document.addEventListener('visibilitychange', handleVisibilityChange);

function createInitialState(limits) {
  return {
    baseX: 0,
    baseY: 0,
    baseHeading: 0,
    baseMotion: 'idle',
    ...Object.fromEntries(
      Object.entries(limits).map(([key, value]) => [key, value.initial])
    ),
  };
}

function handleKeyDown(event) {
  const key = normalizeInput(event);
  if (!(key in robotConfig.keymap)) {
    return;
  }

  event.preventDefault();
  if (pressedKeys.has(key)) {
    return;
  }

  pressedKeys.add(key);
  controls.setKeyActive(key, true);

  if (key === 's') {
    startResetCountdown();
  }

  startLoop();
}

function handleKeyUp(event) {
  const key = normalizeInput(event);
  pressedKeys.delete(key);
  controls.setKeyActive(key, false);

  if (key === 's') {
    cancelResetCountdown();
  }

  if (key === 'shift') {
    for (const activeKey of Array.from(pressedKeys)) {
      controls.setKeyActive(activeKey, true);
    }
  }

  if (pressedKeys.size === 0 && animationFrame) {
    cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }

  render();
}

function startLoop() {
  if (animationFrame) {
    return;
  }

  const tick = () => {
    applyControls();
    render();
    if (pressedKeys.size > 0) {
      animationFrame = requestAnimationFrame(tick);
    } else {
      animationFrame = null;
    }
  };

  animationFrame = requestAnimationFrame(tick);
}

function applyControls() {
  const reverse = pressedKeys.has('shift');
  const moveStep = 1.35;
  const turnStep = 0.7;
  state.baseMotion = 'idle';

  if (pressedKeys.has('arrowup')) {
    const direction = reverse ? -1 : 1;
    const radians = ((state.baseHeading - 90) * Math.PI) / 180;
    state.baseX += Math.cos(radians) * moveStep * direction;
    state.baseY += Math.sin(radians) * moveStep * direction;
    state.baseMotion = direction > 0 ? 'forward' : 'reverse';
  }

  if (pressedKeys.has('arrowleft')) {
    state.baseHeading += reverse ? turnStep : -turnStep;
    state.baseMotion = reverse ? 'turn-right' : 'turn-left';
  }

  if (pressedKeys.has('arrowright')) {
    state.baseHeading += reverse ? -turnStep : turnStep;
    state.baseMotion = reverse ? 'turn-left' : 'turn-right';
  }

  applyJoint('q', 'leftShoulderLift', reverse ? -1 : 1);
  applyJoint('e', 'rightShoulderLift', reverse ? -1 : 1);
  applyJoint('a', 'leftShoulderRotate', reverse ? -1 : 1);
  applyJoint('d', 'rightShoulderRotate', reverse ? -1 : 1);
  applyJoint('z', 'leftElbow', reverse ? -1 : 1);
  applyJoint('c', 'rightElbow', reverse ? -1 : 1);
  applyJoint('w', 'leftGripper', reverse ? -1 : 1);
  applyJoint('x', 'rightGripper', reverse ? -1 : 1);
}

function applyJoint(key, jointName, direction) {
  if (!pressedKeys.has(key)) {
    return;
  }
  const { min, max, step } = robotConfig.limits[jointName];
  const next = state[jointName] + step * direction;
  state[jointName] = Math.max(min, Math.min(max, next));
}

function startResetCountdown() {
  cancelResetCountdown();
  resetStatus.textContent = 'Holding...';
  resetTimer = window.setTimeout(() => {
    Object.entries(robotConfig.limits).forEach(([key, value]) => {
      state[key] = value.initial;
    });
    state.baseMotion = 'idle';
    resetStatus.textContent = 'Reset complete';
    render();
  }, robotConfig.keymap.s.holdMs);
}

function cancelResetCountdown() {
  if (resetTimer) {
    clearTimeout(resetTimer);
    resetTimer = null;
  }
  resetStatus.textContent = 'Ready';
}

function render() {
  scene.render(state);
  baseStatus.textContent = formatBaseStatus(state.baseMotion);
}

function formatBaseStatus(motion) {
  switch (motion) {
    case 'forward':
      return 'Forward';
    case 'reverse':
      return 'Reverse';
    case 'turn-left':
      return 'Turning Left';
    case 'turn-right':
      return 'Turning Right';
    default:
      return 'Idle';
  }
}

function handleVisibilityChange() {
  if (document.hidden) {
    clearPressedKeys();
  }
}

function clearPressedKeys() {
  for (const key of Array.from(pressedKeys)) {
    controls.setKeyActive(key, false);
  }
  pressedKeys.clear();
  cancelResetCountdown();
  if (animationFrame) {
    cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }
  state.baseMotion = 'idle';
  render();
}

function normalizeInput(event) {
  const codeMap = {
    ShiftLeft: 'shift',
    ShiftRight: 'shift',
    KeyQ: 'q',
    KeyE: 'e',
    KeyA: 'a',
    KeyD: 'd',
    KeyZ: 'z',
    KeyC: 'c',
    KeyW: 'w',
    KeyX: 'x',
    KeyS: 's',
    ArrowUp: 'arrowup',
    ArrowLeft: 'arrowleft',
    ArrowRight: 'arrowright',
  };

  if (codeMap[event.code]) {
    return codeMap[event.code];
  }

  if (event.key === 'Shift') {
    return 'shift';
  }

  return event.key.toLowerCase();
}
