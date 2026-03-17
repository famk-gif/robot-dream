const JOINT_LABELS = {
  leftShoulderLift: "????",
  rightShoulderLift: "????",
  leftShoulderRotate: "?????",
  rightShoulderRotate: "?????",
  leftElbow: "????",
  rightElbow: "????",
  leftGripper: "???",
  rightGripper: "???",
};

const BOX_FACES = [
  { idx: [0, 1, 2, 3], shade: 1.0 },
  { idx: [4, 5, 6, 7], shade: 0.7 },
  { idx: [0, 1, 5, 4], shade: 0.92 },
  { idx: [3, 2, 6, 7], shade: 0.64 },
  { idx: [1, 2, 6, 5], shade: 0.82 },
  { idx: [0, 3, 7, 4], shade: 0.56 },
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function degToRad(value) {
  return (value * Math.PI) / 180;
}

function rotateX(point, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: point.x, y: point.y * c - point.z * s, z: point.y * s + point.z * c };
}

function rotateY(point, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: point.x * c + point.z * s, y: point.y, z: -point.x * s + point.z * c };
}

function rotateZ(point, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: point.x * c - point.y * s, y: point.x * s + point.y * c, z: point.z };
}

function transformPoint(point, rotation, translation) {
  let p = { ...point };
  if (rotation.x) p = rotateX(p, rotation.x);
  if (rotation.y) p = rotateY(p, rotation.y);
  if (rotation.z) p = rotateZ(p, rotation.z);
  return {
    x: p.x + translation.x,
    y: p.y + translation.y,
    z: p.z + translation.z,
  };
}

function createBox(center, size, rotation, color) {
  const hx = size.x / 2;
  const hy = size.y / 2;
  const hz = size.z / 2;
  const local = [
    { x: -hx, y: hy, z: hz },
    { x: hx, y: hy, z: hz },
    { x: hx, y: -hy, z: hz },
    { x: -hx, y: -hy, z: hz },
    { x: -hx, y: hy, z: -hz },
    { x: hx, y: hy, z: -hz },
    { x: hx, y: -hy, z: -hz },
    { x: -hx, y: -hy, z: -hz },
  ];
  const vertices = local.map((point) => transformPoint(point, rotation, center));
  return BOX_FACES.map((face) => ({
    points: face.idx.map((index) => vertices[index]),
    shade: face.shade,
    color,
  }));
}

function shadeColor(hex, factor) {
  const normalized = hex.replace('#', '');
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  const apply = (channel) => Math.round(clamp(channel * factor, 0, 255));
  return `rgb(${apply(r)}, ${apply(g)}, ${apply(b)})`;
}

export function createRobotScene(container) {
  container.innerHTML = `
    <canvas class="scene-canvas" id="scene-canvas"></canvas>
    <div class="scene-hint">????????</div>
    <div class="scene-overlay" id="joint-overlay"></div>
  `;

  const canvas = container.querySelector('#scene-canvas');
  const overlay = container.querySelector('#joint-overlay');
  const ctx = canvas.getContext('2d');

  let viewYaw = -0.65;
  let viewPitch = -0.28;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let latestState = null;

  const bodyColor = '#9fc6ff';
  const darkColor = '#26384d';
  const jointColor = '#7cf0c4';
  const wheelColor = '#111723';
  const wheelInner = '#8cf4ff';

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const { clientWidth, clientHeight } = container;
    canvas.width = clientWidth * ratio;
    canvas.height = clientHeight * ratio;
    canvas.style.width = `${clientWidth}px`;
    canvas.style.height = `${clientHeight}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (latestState) render(latestState);
  }

  function project(point) {
    let p = rotateY(point, viewYaw);
    p = rotateX(p, viewPitch);
    const distance = 11;
    const focal = 780;
    const depth = p.z + distance;
    const scale = focal / depth;
    return {
      x: p.x * scale + container.clientWidth / 2,
      y: -p.y * scale + container.clientHeight * 0.62,
      depth,
    };
  }

  function drawPolygon(points, color, stroke = 'rgba(255,255,255,0.08)') {
    const projected = points.map(project);
    const avgDepth = projected.reduce((sum, point) => sum + point.depth, 0) / projected.length;
    return {
      avgDepth,
      draw() {
        ctx.beginPath();
        ctx.moveTo(projected[0].x, projected[0].y);
        for (let i = 1; i < projected.length; i += 1) {
          ctx.lineTo(projected[i].x, projected[i].y);
        }
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1;
        ctx.stroke();
      },
    };
  }

  function buildWheel(center, spin) {
    const faces = [];
    const steps = 14;
    for (let i = 0; i < steps; i += 1) {
      const a0 = (i / steps) * Math.PI * 2 + spin;
      const a1 = ((i + 1) / steps) * Math.PI * 2 + spin;
      const r = 0.38;
      const t = 0.18;
      const front = [
        { x: center.x - t, y: center.y + Math.cos(a0) * r, z: center.z + Math.sin(a0) * r },
        { x: center.x - t, y: center.y + Math.cos(a1) * r, z: center.z + Math.sin(a1) * r },
        { x: center.x + t, y: center.y + Math.cos(a1) * r, z: center.z + Math.sin(a1) * r },
        { x: center.x + t, y: center.y + Math.cos(a0) * r, z: center.z + Math.sin(a0) * r },
      ];
      faces.push(drawPolygon(front, shadeColor(wheelColor, 0.72 + (i % 2) * 0.08), 'rgba(255,255,255,0.04)'));
    }

    const disc = [];
    const inner = [];
    for (let i = 0; i < steps; i += 1) {
      const angle = (i / steps) * Math.PI * 2;
      disc.push({ x: center.x + 0.19, y: center.y + Math.cos(angle) * 0.32, z: center.z + Math.sin(angle) * 0.32 });
      inner.push({ x: center.x + 0.2, y: center.y + Math.cos(angle) * 0.14, z: center.z + Math.sin(angle) * 0.14 });
    }
    faces.push(drawPolygon(disc, shadeColor(wheelColor, 1.0)));
    faces.push(drawPolygon(inner, wheelInner, 'rgba(255,255,255,0.14)'));
    return faces;
  }

  function buildArm(side, state) {
    const sign = side === 'left' ? -1 : 1;
    const shoulderBase = { x: sign * 1.48, y: 2.55, z: 0 };
    const liftAngle = degToRad((side === 'left' ? state.leftShoulderLift : state.rightShoulderLift) - 20);
    const reachAngle = degToRad((side === 'left' ? state.leftShoulderRotate : state.rightShoulderRotate) * sign);
    const elbowAngle = degToRad((side === 'left' ? state.leftElbow : state.rightElbow) - 30);
    const gripAngle = degToRad(side === 'left' ? state.leftGripper : state.rightGripper);

    const shoulderRotation = { x: 0, y: reachAngle, z: sign * -liftAngle };
    const upperCenter = transformPoint({ x: sign * 0.58, y: -0.52, z: 0 }, shoulderRotation, shoulderBase);
    const elbowCenter = transformPoint({ x: sign * 1.14, y: -1.02, z: 0 }, shoulderRotation, shoulderBase);

    const forearmRotation = {
      x: 0,
      y: reachAngle,
      z: sign * -(liftAngle + elbowAngle),
    };
    const lowerCenter = transformPoint({ x: sign * 1.68, y: -1.34, z: 0 }, forearmRotation, shoulderBase);
    const wristCenter = transformPoint({ x: sign * 2.08, y: -1.62, z: 0 }, forearmRotation, shoulderBase);

    const palmCenter = transformPoint({ x: sign * 2.28, y: -1.7, z: 0 }, forearmRotation, shoulderBase);
    const fingerOffsetA = transformPoint({ x: sign * 2.44, y: -1.8, z: 0.12 }, forearmRotation, shoulderBase);
    const fingerOffsetB = transformPoint({ x: sign * 2.44, y: -1.8, z: -0.12 }, forearmRotation, shoulderBase);

    return [
      ...createBox(shoulderBase, { x: 0.22, y: 0.22, z: 0.22 }, { x: 0, y: 0, z: 0 }, jointColor),
      ...createBox(upperCenter, { x: 0.32, y: 1.08, z: 0.32 }, shoulderRotation, bodyColor),
      ...createBox(elbowCenter, { x: 0.2, y: 0.2, z: 0.2 }, { x: 0, y: 0, z: 0 }, jointColor),
      ...createBox(lowerCenter, { x: 0.28, y: 0.9, z: 0.28 }, forearmRotation, bodyColor),
      ...createBox(wristCenter, { x: 0.16, y: 0.16, z: 0.16 }, { x: 0, y: 0, z: 0 }, jointColor),
      ...createBox(palmCenter, { x: 0.26, y: 0.18, z: 0.24 }, forearmRotation, darkColor),
      ...createBox(fingerOffsetA, { x: 0.08, y: 0.34, z: 0.08 }, { x: 0, y: 0, z: reachAngle + gripAngle * sign }, jointColor),
      ...createBox(fingerOffsetB, { x: 0.08, y: 0.34, z: 0.08 }, { x: 0, y: 0, z: reachAngle - gripAngle * sign }, jointColor),
    ];
  }

  function buildScene(state) {
    const faces = [];
    const baseHeading = degToRad(state.baseHeading);
    const baseOffset = {
      x: state.baseX / 55,
      y: 0,
      z: state.baseY / 55,
    };

    function addBox(localCenter, size, rotation, color) {
      const center = transformPoint(localCenter, { x: 0, y: baseHeading, z: 0 }, baseOffset);
      const combinedRotation = { x: rotation.x || 0, y: (rotation.y || 0) + baseHeading, z: rotation.z || 0 };
      faces.push(...createBox(center, size, combinedRotation, color));
    }

    addBox({ x: 0, y: 0.42, z: 0 }, { x: 3.6, y: 0.54, z: 3.6 }, { x: 0, y: 0, z: 0 }, darkColor);
    addBox({ x: 0, y: 1.34, z: 0 }, { x: 0.52, y: 1.2, z: 0.52 }, { x: 0, y: 0, z: 0 }, darkColor);
    addBox({ x: 0, y: 2.5, z: 0 }, { x: 2.0, y: 2.0, z: 1.2 }, { x: 0, y: 0, z: 0 }, bodyColor);
    addBox({ x: 0, y: 3.86, z: 0 }, { x: 0.4, y: 0.34, z: 0.4 }, { x: 0, y: 0, z: 0 }, darkColor);
    addBox({ x: 0, y: 4.54, z: 0 }, { x: 1.1, y: 1.0, z: 0.94 }, { x: 0, y: 0, z: 0 }, '#eaf5ff');

    const wheelCenters = [
      { x: -1.8, y: 0.38, z: 1.8 },
      { x: 1.8, y: 0.38, z: 1.8 },
      { x: -1.8, y: 0.38, z: -1.8 },
      { x: 1.8, y: 0.38, z: -1.8 },
    ].map((point) => transformPoint(point, { x: 0, y: baseHeading, z: 0 }, baseOffset));

    const wheelSpin = state.baseMotion === 'forward' ? -0.34 : state.baseMotion === 'reverse' ? 0.34 : 0;
    wheelCenters.forEach((center, index) => {
      faces.push(...buildWheel(center, wheelSpin * (index + 1)));
    });

    const leftArmFaces = buildArm('left', state).map((face) => ({
      ...face,
      points: face.points.map((point) => transformPoint(point, { x: 0, y: baseHeading, z: 0 }, baseOffset)),
    }));
    const rightArmFaces = buildArm('right', state).map((face) => ({
      ...face,
      points: face.points.map((point) => transformPoint(point, { x: 0, y: baseHeading, z: 0 }, baseOffset)),
    }));

    faces.push(...leftArmFaces, ...rightArmFaces);
    return faces;
  }

  function render(state) {
    latestState = state;
    ctx.clearRect(0, 0, container.clientWidth, container.clientHeight);

    const ground = [
      { x: -5.8, y: 0, z: 5.8 },
      { x: 5.8, y: 0, z: 5.8 },
      { x: 5.8, y: 0, z: -5.8 },
      { x: -5.8, y: 0, z: -5.8 },
    ];
    drawPolygon(ground, 'rgba(18,38,58,0.7)', 'rgba(90,140,180,0.12)').draw();

    const faces = buildScene(state)
      .map((face) => ({
        avgDepth: face.points.reduce((sum, point) => sum + project(point).depth, 0) / face.points.length,
        draw: () => drawPolygon(face.points, shadeColor(face.color, face.shade)).draw(),
      }))
      .sort((a, b) => b.avgDepth - a.avgDepth);

    faces.forEach((face) => face.draw());

    overlay.innerHTML = Object.entries(JOINT_LABELS)
      .map(([key, label]) => `<div><span>${label}</span><strong>${Math.round(state[key])}&deg;</strong></div>`)
      .join('');
  }

  canvas.addEventListener('mousedown', (event) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    container.classList.add('dragging');
  });

  window.addEventListener('mouseup', () => {
    dragging = false;
    container.classList.remove('dragging');
  });

  window.addEventListener('mousemove', (event) => {
    if (!dragging) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    viewYaw += dx * 0.01;
    viewPitch = clamp(viewPitch - dy * 0.006, -0.8, 0.15);
    if (latestState) render(latestState);
  });

  window.addEventListener('resize', resize);
  resize();

  return { render };
}
