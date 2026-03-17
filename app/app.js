(function () {
  const config = {
    limits: {
      leftShoulderLift: { min: 10, max: 10, initial: 10, step: 0, label: '左臂侧抬(XOY)' },
      rightShoulderLift: { min: 10, max: 10, initial: 10, step: 0, label: '右臂侧抬(XOY)' },
      leftShoulderRotate: { min: -10, max: 65, initial: 0, step: 2, label: '左臂前抬(YOZ)' },
      rightShoulderRotate: { min: -10, max: 65, initial: 0, step: 2, label: '右臂前抬(YOZ)' },
      leftElbow: { min: 5, max: 120, initial: 5, step: 3, label: '左肘弯折' },
      rightElbow: { min: 5, max: 120, initial: 5, step: 3, label: '右肘弯折' },
      leftGripper: { min: 0, max: 30, initial: 10, step: 2, label: '左夹爪开合' },
      rightGripper: { min: 0, max: 30, initial: 10, step: 2, label: '右夹爪开合' },
    },
    controlGroups: [
      {
        title: '底盘移动',
        description: '方向键控制底盘，↑ 前进，Shift+↑ 后退，←/→ 左右转向。',
        keys: [
          { key: '↑', code: 'arrowup', action: '前进 / Shift+↑ 后退' },
          { key: '←', code: 'arrowleft', action: '底盘左转' },
          { key: '→', code: 'arrowright', action: '底盘右转' },
          { key: 'Shift', code: 'shift', action: '机械臂反向细调' },
        ],
      },
      {
        title: '双臂控制',
        description: 'A/D 在 YOZ 平面前抬，Z/C 绕肘弯折，Q/E 开合夹爪。',
        keys: [
          { key: 'A', code: 'a', action: '左臂前抬(YOZ)' },
          { key: 'D', code: 'd', action: '右臂前抬(YOZ)' },
          { key: 'Z', code: 'z', action: '左肘弯折' },
          { key: 'C', code: 'c', action: '右肘弯折' },
          { key: 'Q', code: 'q', action: '左夹爪开合' },
          { key: 'E', code: 'e', action: '右夹爪开合' },
        ],
      },
      {
        title: '复位',
        description: '按住 S 三秒，把双臂角度恢复到初始姿态。',
        keys: [
          { key: 'S', code: 's', action: '长按 3 秒复位双臂' },
        ],
      },
    ],
  };

  const stage = document.getElementById('robot-stage');
  const panel = document.getElementById('control-panel');
  const baseStatus = document.getElementById('base-status');
  const resetStatus = document.getElementById('reset-status');
  const armStatus = document.getElementById('arm-status');

  stage.innerHTML = `
    <canvas class="scene-canvas" id="scene-canvas"></canvas>
    <div class="scene-hint">拖动视角，键盘直接操控机械臂</div>
    <div class="scene-badge">Continuous Arm Preview</div>
    <div class="scene-overlay" id="scene-overlay"></div>
  `;

  panel.innerHTML = `
    <section class="panel-section panel-section-accent">
      <p class="panel-eyebrow">Control Guide</p>
      <h2>键位说明</h2>
      <p class="panel-copy">现在这版把控制键位和动作含义写全了，按下键时对应卡片会高亮，方便边试边看。</p>
    </section>
    <section class="panel-section">
      <p class="panel-eyebrow">Live State</p>
      <h2>当前关节范围</h2>
      <div class="range-grid" id="range-grid"></div>
    </section>
    ${config.controlGroups.map((group) => `
      <section class="panel-section">
        <p class="panel-eyebrow">${group.title}</p>
        <h2>${group.title}</h2>
        <p class="panel-copy">${group.description}</p>
        <div class="key-grid">
          ${group.keys.map((item) => `
            <div class="key-card" data-key="${item.code}">
              <kbd>${item.key}</kbd>
              <strong>${item.action}</strong>
            </div>
          `).join('')}
        </div>
      </section>
    `).join('')}
  `;

  const canvas = document.getElementById('scene-canvas');
  const overlay = null;
  const rangeGrid = document.getElementById('range-grid');
  const ctx = canvas.getContext('2d');

  const rangeLabels = {};
  Object.entries(config.limits).forEach(([joint, meta]) => {
    rangeGrid.insertAdjacentHTML('beforeend', `
      <div class="range-card">
        <span>${meta.label}</span>
        <strong id="range-${joint}">${meta.initial}&deg;</strong>
        <small>${meta.min}&deg; ~ ${meta.max}&deg;</small>
      </div>
    `);
    rangeLabels[joint] = document.getElementById(`range-${joint}`);
  });

  const keyCards = Object.fromEntries(
    Array.from(panel.querySelectorAll('.key-card')).map((card) => [card.dataset.key, card])
  );

  const labels = Object.fromEntries(
    Object.entries(config.limits).map(([joint, meta]) => [joint, meta.label])
  );

  const state = {
    baseX: 0,
    baseY: 0,
    baseHeading: 0,
    baseMotion: 'idle',
    ...Object.fromEntries(Object.entries(config.limits).map(([joint, meta]) => [joint, meta.initial])),
  };
  const targets = { ...state };
  const jointSpeeds = {
    leftShoulderLift: 90,
    rightShoulderLift: 90,
    leftShoulderRotate: 140,
    rightShoulderRotate: 140,
    leftElbow: 160,
    rightElbow: 160,
    leftGripper: 240,
    rightGripper: 240,
  };

  const pressed = new Set();
  let dragging = false;
  let viewYaw = Math.PI;
  let viewPitch = -0.28;
  let lastX = 0;
  let lastY = 0;
  let resetTimer = null;
  let typeBuffer = '';
  let typeTimer = null;
  const gesture = {
    active: false,
    start: 0,
    duration: 4400,
    snapshot: null,
  };
  let lastFrame = performance.now();

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function moveToward(current, target, maxDelta) {
    const delta = target - current;
    if (Math.abs(delta) <= maxDelta) {
      return target;
    }
    return current + Math.sign(delta) * maxDelta;
  }

  function rad(value) {
    return (value * Math.PI) / 180;
  }

  function rotX(point, angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return { x: point.x, y: point.y * c - point.z * s, z: point.y * s + point.z * c };
  }

  function rotY(point, angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return { x: point.x * c + point.z * s, y: point.y, z: -point.x * s + point.z * c };
  }

  function rotZ(point, angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return { x: point.x * c - point.y * s, y: point.x * s + point.y * c, z: point.z };
  }

  function rotMatX(angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return [
      [1, 0, 0],
      [0, c, -s],
      [0, s, c],
    ];
  }

  function rotMatY(angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return [
      [c, 0, s],
      [0, 1, 0],
      [-s, 0, c],
    ];
  }

  function rotMatZ(angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return [
      [c, -s, 0],
      [s, c, 0],
      [0, 0, 1],
    ];
  }

  function matMul(a, b) {
    return [
      [
        a[0][0] * b[0][0] + a[0][1] * b[1][0] + a[0][2] * b[2][0],
        a[0][0] * b[0][1] + a[0][1] * b[1][1] + a[0][2] * b[2][1],
        a[0][0] * b[0][2] + a[0][1] * b[1][2] + a[0][2] * b[2][2],
      ],
      [
        a[1][0] * b[0][0] + a[1][1] * b[1][0] + a[1][2] * b[2][0],
        a[1][0] * b[0][1] + a[1][1] * b[1][1] + a[1][2] * b[2][1],
        a[1][0] * b[0][2] + a[1][1] * b[1][2] + a[1][2] * b[2][2],
      ],
      [
        a[2][0] * b[0][0] + a[2][1] * b[1][0] + a[2][2] * b[2][0],
        a[2][0] * b[0][1] + a[2][1] * b[1][1] + a[2][2] * b[2][1],
        a[2][0] * b[0][2] + a[2][1] * b[1][2] + a[2][2] * b[2][2],
      ],
    ];
  }

  function matVec(m, point) {
    return {
      x: m[0][0] * point.x + m[0][1] * point.y + m[0][2] * point.z,
      y: m[1][0] * point.x + m[1][1] * point.y + m[1][2] * point.z,
      z: m[2][0] * point.x + m[2][1] * point.y + m[2][2] * point.z,
    };
  }

  function applyRotation(point, rotation) {
    if (rotation && rotation.matrix) {
      return matVec(rotation.matrix, point);
    }
    let next = { ...point };
    if (rotation.x) next = rotX(next, rotation.x);
    if (rotation.y) next = rotY(next, rotation.y);
    if (rotation.z) next = rotZ(next, rotation.z);
    return next;
  }

  function transform(point, rotation, translation) {
    const next = applyRotation(point, rotation);
    return {
      x: next.x + translation.x,
      y: next.y + translation.y,
      z: next.z + translation.z,
    };
  }

  function project(point) {
    let next = rotY(point, viewYaw);
    next = rotX(next, viewPitch);
    const distance = 16;
    const focal = 980;
    const depth = next.z + distance;
    const scale = focal / depth;
    return {
      x: next.x * scale + stage.clientWidth / 2,
      y: -next.y * scale + stage.clientHeight * 0.55,
      depth,
    };
  }

  function shade(hex, factor) {
    const normalized = hex.replace('#', '');
    const r = parseInt(normalized.slice(0, 2), 16);
    const g = parseInt(normalized.slice(2, 4), 16);
    const b = parseInt(normalized.slice(4, 6), 16);
    const apply = (channel) => Math.round(clamp(channel * factor, 0, 255));
    return `rgb(${apply(r)}, ${apply(g)}, ${apply(b)})`;
  }

  function polygon(points, fill, stroke = 'rgba(255,255,255,0.12)') {
    const projected = points.map(project);
    return {
      depth: projected.reduce((sum, point) => sum + point.depth, 0) / projected.length,
      paint() {
        ctx.beginPath();
        ctx.moveTo(projected[0].x, projected[0].y);
        for (let i = 1; i < projected.length; i += 1) {
          ctx.lineTo(projected[i].x, projected[i].y);
        }
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1;
        ctx.stroke();
      },
    };
  }
  function drawAxisGizmo(origin, heading) {
    const axisLength = 0.9;
    const labelOffset = 0.12;
    const axes = [
      {
        label: 'X',
        color: '#ff5f5f',
        end: transform({ x: axisLength, y: 0, z: 0 }, { x: 0, y: heading, z: 0 }, origin),
      },
      {
        label: 'Y',
        color: '#67ff9a',
        end: transform({ x: 0, y: axisLength, z: 0 }, { x: 0, y: heading, z: 0 }, origin),
      },
      {
        label: 'Z',
        color: '#5fb6ff',
        end: transform({ x: 0, y: 0, z: axisLength }, { x: 0, y: heading, z: 0 }, origin),
      },
    ].map((axis) => ({
      ...axis,
      start2d: project(origin),
      end2d: project(axis.end),
      depth: (project(origin).depth + project(axis.end).depth) / 2,
    })).sort((a, b) => b.depth - a.depth);

    axes.forEach((axis) => {
      ctx.beginPath();
      ctx.moveTo(axis.start2d.x, axis.start2d.y);
      ctx.lineTo(axis.end2d.x, axis.end2d.y);
      ctx.strokeStyle = axis.color;
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(axis.end2d.x, axis.end2d.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = axis.color;
      ctx.fill();

      ctx.fillStyle = axis.color;
      ctx.font = 'bold 14px Segoe UI';
      ctx.fillText(axis.label, axis.end2d.x + labelOffset * 20, axis.end2d.y - labelOffset * 12);
    });
  }

  function makeBox(center, size, rotation, color) {
    const hx = size.x / 2;
    const hy = size.y / 2;
    const hz = size.z / 2;
    const vertices = [
      { x: -hx, y: hy, z: hz },
      { x: hx, y: hy, z: hz },
      { x: hx, y: -hy, z: hz },
      { x: -hx, y: -hy, z: hz },
      { x: -hx, y: hy, z: -hz },
      { x: hx, y: hy, z: -hz },
      { x: hx, y: -hy, z: -hz },
      { x: -hx, y: -hy, z: -hz },
    ].map((point) => transform(point, rotation, center));

    const faces = [
      { idx: [0, 1, 2, 3], shade: 1.0 },
      { idx: [4, 5, 6, 7], shade: 0.62 },
      { idx: [0, 1, 5, 4], shade: 0.9 },
      { idx: [3, 2, 6, 7], shade: 0.56 },
      { idx: [1, 2, 6, 5], shade: 0.82 },
      { idx: [0, 3, 7, 4], shade: 0.72 },
    ];

    return faces.map((face) => polygon(face.idx.map((index) => vertices[index]), shade(color, face.shade)));
  }

  function makeCylinder(center, size, rotation, color, sides = 10) {
    const halfLength = size.y / 2;
    const radiusX = size.x / 2;
    const radiusZ = size.z / 2;
    const top = [];
    const bottom = [];

    for (let i = 0; i < sides; i += 1) {
      const angle = (i / sides) * Math.PI * 2;
      const ringPoint = {
        x: Math.cos(angle) * radiusX,
        y: 0,
        z: Math.sin(angle) * radiusZ,
      };
      top.push(transform({ ...ringPoint, y: -halfLength }, rotation, center));
      bottom.push(transform({ ...ringPoint, y: halfLength }, rotation, center));
    }

    const faces = [];
    for (let i = 0; i < sides; i += 1) {
      const next = (i + 1) % sides;
      const brightness = 0.72 + Math.max(0, Math.cos((i / sides) * Math.PI * 2 - Math.PI / 3)) * 0.26;
      faces.push(polygon(
        [top[i], top[next], bottom[next], bottom[i]],
        shade(color, brightness),
        'rgba(255,255,255,0.08)'
      ));
    }

    faces.push(polygon([...top].reverse(), shade(color, 1.04)));
    faces.push(polygon(bottom, shade(color, 0.7)));
    return faces;
  }

  function makeSphere(center, radius, color, segments = 10, rings = 6) {
    const faces = [];
    const grid = [];

    for (let ring = 0; ring <= rings; ring += 1) {
      const phi = (ring / rings) * Math.PI;
      const ringRadius = Math.sin(phi) * radius;
      const y = Math.cos(phi) * radius;
      const band = [];

      for (let seg = 0; seg < segments; seg += 1) {
        const theta = (seg / segments) * Math.PI * 2;
        band.push({
          x: center.x + Math.cos(theta) * ringRadius,
          y: center.y + y,
          z: center.z + Math.sin(theta) * ringRadius,
        });
      }

      grid.push(band);
    }

    for (let ring = 0; ring < rings; ring += 1) {
      for (let seg = 0; seg < segments; seg += 1) {
        const next = (seg + 1) % segments;
        const brightness = 0.72 + ((rings - ring) / rings) * 0.22 + Math.max(0, Math.cos((seg / segments) * Math.PI * 2 - 0.5)) * 0.1;
        faces.push(polygon(
          [grid[ring][seg], grid[ring][next], grid[ring + 1][next], grid[ring + 1][seg]],
          shade(color, brightness),
          'rgba(255,255,255,0.06)'
        ));
      }
    }

    return faces;
  }


  function makeCapsule(center, size, rotation, color, sides = 12) {
    const radius = Math.max(size.x, size.z) / 2;
    const coreLength = Math.max(0.08, size.y - radius * 2);
    const topCenter = transform({ x: 0, y: -coreLength / 2, z: 0 }, rotation, center);
    const bottomCenter = transform({ x: 0, y: coreLength / 2, z: 0 }, rotation, center);

    return [
      ...makeSphere(shoulder, 0.11, jointColor, 8, 5),
      ...makeCylinder(upper, { x: 0.26, y: 1.0, z: 0.26 }, upperWorldRotation, armColor, 10),
      ...makeSphere(elbowJoint, 0.1, jointColor, 8, 5),
      ...makeCylinder(lower, { x: 0.22, y: 0.96, z: 0.22 }, forearmWorldRotation, armColor, 10),
      ...makeBox(wrist, { x: 0.14, y: 0.14, z: 0.14 }, forearmWorldRotation, armColor),
      ...makeBox(hand, { x: 0.2, y: 0.2, z: 0.2 }, forearmWorldRotation, handColor),
      ...makeBox(fingerBase, { x: 0.18, y: 0.12, z: 0.18 }, forearmWorldRotation, jointColor),
    ];
  }
  function makeNestedBox(localCenter, size, localRotation, parentRotation, parentTranslation, color) {
    const hx = size.x / 2;
    const hy = size.y / 2;
    const hz = size.z / 2;
    const vertices = [
      { x: -hx, y: hy, z: hz },
      { x: hx, y: hy, z: hz },
      { x: hx, y: -hy, z: hz },
      { x: -hx, y: -hy, z: hz },
      { x: -hx, y: hy, z: -hz },
      { x: hx, y: hy, z: -hz },
      { x: hx, y: -hy, z: -hz },
      { x: -hx, y: -hy, z: -hz },
    ].map((point) => transform(transform(point, localRotation, localCenter), parentRotation, parentTranslation));

    const faces = [
      { idx: [0, 1, 2, 3], shade: 1.0 },
      { idx: [4, 5, 6, 7], shade: 0.62 },
      { idx: [0, 1, 5, 4], shade: 0.9 },
      { idx: [3, 2, 6, 7], shade: 0.56 },
      { idx: [1, 2, 6, 5], shade: 0.82 },
      { idx: [0, 3, 7, 4], shade: 0.72 },
    ];

    return faces.map((face) => polygon(face.idx.map((index) => vertices[index]), shade(color, face.shade)));
  }

  function makeWheel(center, spin) {
    const result = [];
    const steps = 16;
    const radius = 0.44;
    const thickness = 0.2;

    for (let i = 0; i < steps; i += 1) {
      const start = (i / steps) * Math.PI * 2 + spin;
      const end = ((i + 1) / steps) * Math.PI * 2 + spin;
      result.push(polygon(
        [
          { x: center.x - thickness, y: center.y + Math.cos(start) * radius, z: center.z + Math.sin(start) * radius },
          { x: center.x - thickness, y: center.y + Math.cos(end) * radius, z: center.z + Math.sin(end) * radius },
          { x: center.x + thickness, y: center.y + Math.cos(end) * radius, z: center.z + Math.sin(end) * radius },
          { x: center.x + thickness, y: center.y + Math.cos(start) * radius, z: center.z + Math.sin(start) * radius },
        ],
        shade('#121926', 0.72 + (i % 2) * 0.08),
        'rgba(255,255,255,0.04)'
      ));
    }

    const disc = [];
    const hub = [];
    for (let i = 0; i < steps; i += 1) {
      const angle = (i / steps) * Math.PI * 2;
      disc.push({ x: center.x + thickness, y: center.y + Math.cos(angle) * 0.32, z: center.z + Math.sin(angle) * 0.32 });
      hub.push({ x: center.x + thickness + 0.01, y: center.y + Math.cos(angle) * 0.14, z: center.z + Math.sin(angle) * 0.14 });
    }
    result.push(polygon(disc, '#1f3348'));
    result.push(polygon(hub, '#7be7ff', 'rgba(255,255,255,0.16)'));
    return result;
  }

  function addBoxToScene(list, center, size, rotation, color, heading, offset) {
    const translated = transform(center, { x: 0, y: heading, z: 0 }, offset);
    list.push(...makeBox(translated, size, { x: rotation.x || 0, y: (rotation.y || 0) + heading, z: rotation.z || 0 }, color));
  }

  function worldPoint(point, heading, offset) {
    return transform(point, { x: 0, y: heading, z: 0 }, offset);
  }

  function rotationWithHeading(rotation, heading) {
    return { x: rotation.x || 0, y: (rotation.y || 0) + heading, z: rotation.z || 0 };
  }

  function buildArmFaces(side, heading, offset) {
    const sign = side === 'left' ? -1 : 1;
    const xoyLift = side === 'left' ? state.leftShoulderLift : state.rightShoulderLift;
    const yozLift = side === 'left' ? state.leftShoulderRotate : state.rightShoulderRotate;
    const elbow = side === 'left' ? state.leftElbow : state.rightElbow;
    const grip = side === 'left' ? state.leftGripper : state.rightGripper;
    const maxGrip = config.limits.leftGripper.max || 30;
    const gripRatio = clamp(grip / maxGrip, 0, 1);

    const armColor = '#c2d8ee';
    const handColor = '#26384d';
    const jointColor = '#7ae9c2';

    const armScale = 0.85;
    const shoulderLocal = { x: sign * 1.05, y: 2.7, z: 0 };
    const xoyRotate = rad(xoyLift * sign * 0.95);
    const yozRotate = rad(yozLift * -0.92);
    const elbowPitch = rad((elbow - 15) * -0.92);

    const shoulderMatrix = matMul(rotMatX(yozRotate), rotMatZ(xoyRotate));
    const elbowMatrix = matMul(shoulderMatrix, rotMatX(elbowPitch));

    const elbowLocal = transform(
      { x: sign * 0.34, y: -1.14 * armScale, z: 0 },
      { matrix: shoulderMatrix },
      shoulderLocal
    );
    const wristLocal = transform(
      { x: sign * 0.34, y: -1.14 * armScale, z: 0 },
      { matrix: elbowMatrix },
      elbowLocal
    );
    const handLocal = transform(
      { x: sign * 0.42, y: -1.34 * armScale, z: 0 },
      { matrix: elbowMatrix },
      elbowLocal
    );
    const fingerBaseLocal = transform(
      { x: sign * 0.46, y: -1.46 * armScale, z: 0 },
      { matrix: elbowMatrix },
      elbowLocal
    );
    const fingerOpen = 0.04 + gripRatio * 0.12;
    const fingerALocal = transform(
      { x: sign * 0.52, y: -1.56 * armScale, z: fingerOpen },
      { matrix: elbowMatrix },
      elbowLocal
    );
    const fingerBLocal = transform(
      { x: sign * 0.52, y: -1.56 * armScale, z: -fingerOpen },
      { matrix: elbowMatrix },
      elbowLocal
    );

    const upperLocal = {
      x: (shoulderLocal.x + elbowLocal.x) / 2,
      y: (shoulderLocal.y + elbowLocal.y) / 2,
      z: (shoulderLocal.z + elbowLocal.z) / 2,
    };
    const lowerLocal = {
      x: (elbowLocal.x + wristLocal.x) / 2,
      y: (elbowLocal.y + wristLocal.y) / 2,
      z: (elbowLocal.z + wristLocal.z) / 2,
    };

    const shoulder = worldPoint(shoulderLocal, heading, offset);
    const upper = worldPoint(upperLocal, heading, offset);
    const elbowJoint = worldPoint(elbowLocal, heading, offset);
    const lower = worldPoint(lowerLocal, heading, offset);
    const wrist = worldPoint(wristLocal, heading, offset);
    const hand = worldPoint(handLocal, heading, offset);
    const fingerBase = worldPoint(fingerBaseLocal, heading, offset);
    const fingerA = worldPoint(fingerALocal, heading, offset);
    const fingerB = worldPoint(fingerBLocal, heading, offset);

    const headingMatrix = rotMatY(heading);
    const upperWorldRotation = { matrix: matMul(headingMatrix, shoulderMatrix) };
    const forearmWorldRotation = { matrix: matMul(headingMatrix, elbowMatrix) };

    return [
      ...makeSphere(shoulder, 0.11, jointColor, 8, 5),
      ...makeCylinder(upper, { x: 0.26, y: 1.0 * armScale, z: 0.26 }, upperWorldRotation, armColor, 10),
      ...makeSphere(elbowJoint, 0.1, jointColor, 8, 5),
      ...makeCylinder(lower, { x: 0.22, y: 0.96 * armScale, z: 0.22 }, forearmWorldRotation, armColor, 10),
      ...makeBox(wrist, { x: 0.14, y: 0.14, z: 0.14 }, forearmWorldRotation, armColor),
      ...makeBox(hand, { x: 0.2, y: 0.2, z: 0.2 }, forearmWorldRotation, handColor),
      ...makeBox(fingerBase, { x: 0.18, y: 0.12, z: 0.18 }, forearmWorldRotation, jointColor),
      ...makeBox(fingerA, { x: 0.08, y: 0.28 * armScale, z: 0.08 }, forearmWorldRotation, jointColor),
      ...makeBox(fingerB, { x: 0.08, y: 0.28 * armScale, z: 0.08 }, forearmWorldRotation, jointColor),
    ];
  }

  function drawRobot() {
    const heading = rad(state.baseHeading);
    const offset = { x: state.baseX / 55, y: 0, z: state.baseY / 55 };
    const faces = [];

    addBoxToScene(faces, { x: 0, y: 0.31, z: 0 }, { x: 3.7, y: 0.62, z: 3.7 }, {}, '#26384d', heading, offset);
    addBoxToScene(faces, { x: 0, y: 1.05, z: 0 }, { x: 0.72, y: 1.1, z: 0.72 }, {}, '#26384d', heading, offset);
    addBoxToScene(faces, { x: 0, y: 2.05, z: 0 }, { x: 2.0, y: 2.0, z: 1.4 }, {}, '#9fc6ff', heading, offset);
    addBoxToScene(faces, { x: 0, y: 3.35, z: 0 }, { x: 0.4, y: 0.4, z: 0.4 }, {}, '#26384d', heading, offset);
    addBoxToScene(faces, { x: 0, y: 3.85, z: 0 }, { x: 1.0, y: 1.0, z: 0.9 }, {}, '#eef7ff', heading, offset);
    addBoxToScene(faces, { x: -0.18, y: 4.0, z: 0.46 }, { x: 0.12, y: 0.12, z: 0.08 }, {}, '#182535', heading, offset);
    addBoxToScene(faces, { x: 0.18, y: 4.0, z: 0.46 }, { x: 0.12, y: 0.12, z: 0.08 }, {}, '#182535', heading, offset);

    const wheels = [
      { x: -1.86, y: 0.44, z: 1.86 },
      { x: 1.86, y: 0.44, z: 1.86 },
      { x: -1.86, y: 0.44, z: -1.86 },
      { x: 1.86, y: 0.44, z: -1.86 },
    ].map((point) => worldPoint(point, heading, offset));

    const spin = state.baseMotion === 'forward' ? -0.34 : state.baseMotion === 'reverse' ? 0.34 : 0;
    wheels.forEach((center, index) => {
      faces.push(...makeWheel(center, spin * (index + 1)));
    });

    faces.push(...buildArmFaces('left', heading, offset));
    faces.push(...buildArmFaces('right', heading, offset));

    return faces.sort((a, b) => b.depth - a.depth);
  }

  function refreshOverlay() {
    Object.entries(rangeLabels).forEach(([joint, node]) => {
      node.textContent = `${Math.round(state[joint])}°`;
    });

    armStatus.textContent = `${Math.round((state.leftElbow + state.rightElbow) / 2)}° avg`;
  }

  function refreshStatus() {
    baseStatus.textContent = state.baseMotion === 'forward'
      ? 'Forward'
      : state.baseMotion === 'reverse'
      ? 'Reverse'
      : state.baseMotion === 'turn-left'
      ? 'Turning Left'
      : state.baseMotion === 'turn-right'
      ? 'Turning Right'
      : 'Idle';
  }

  function draw() {
    ctx.clearRect(0, 0, stage.clientWidth, stage.clientHeight);

    const ground = polygon(
      [
        { x: -6.5, y: 0, z: 6.5 },
        { x: 6.5, y: 0, z: 6.5 },
        { x: 6.5, y: 0, z: -6.5 },
        { x: -6.5, y: 0, z: -6.5 },
      ],
      'rgba(18,38,58,0.82)',
      'rgba(90,140,180,0.18)'
    );
    ground.paint();

    drawRobot().forEach((face) => face.paint());
    drawAxisGizmo(
      worldPoint({ x: 2.35, y: 2.2, z: -2.2 }, rad(state.baseHeading), { x: state.baseX / 55, y: 0, z: state.baseY / 55 }),
      rad(state.baseHeading)
    );
    refreshOverlay();
    refreshStatus();
  }

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = stage.clientWidth * ratio;
    canvas.height = stage.clientHeight * ratio;
    canvas.style.width = `${stage.clientWidth}px`;
    canvas.style.height = `${stage.clientHeight}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    draw();
  }

  function setKeyActive(code, active) {
    if (keyCards[code]) {
      keyCards[code].classList.toggle('active', active);
    }
  }

  function updateMotion() {
    const reverse = pressed.has('shift');
    state.baseMotion = 'idle';

    [
      ['a', 'leftShoulderRotate', 1],
      ['d', 'rightShoulderRotate', 1],
      ['z', 'leftElbow', 1],
      ['c', 'rightElbow', 1],
      ['q', 'leftGripper', 1],
      ['e', 'rightGripper', 1],
    ].forEach(([key, joint, dir]) => {
      if (!pressed.has(key)) {
        return;
      }
      const meta = config.limits[joint];
      const direction = (reverse ? -1 : 1) * dir;
      targets[joint] = clamp(targets[joint] + meta.step * direction, meta.min, meta.max);
    });
  }

  function keyName(event) {
    const map = {
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
    return map[event.code] || event.key.toLowerCase();
  }

  function clearResetCountdown() {
    if (resetTimer) {
      clearTimeout(resetTimer);
      resetTimer = null;
    }
  }

  function resetPose() {
    Object.entries(config.limits).forEach(([joint, meta]) => {
      state[joint] = meta.initial;
      targets[joint] = meta.initial;
    });
    state.baseMotion = 'idle';
    resetStatus.textContent = 'Reset complete';
  }

  function captureArmState() {
    return {
      leftShoulderLift: state.leftShoulderLift,
      rightShoulderLift: state.rightShoulderLift,
      leftShoulderRotate: state.leftShoulderRotate,
      rightShoulderRotate: state.rightShoulderRotate,
      leftElbow: state.leftElbow,
      rightElbow: state.rightElbow,
      leftGripper: state.leftGripper,
      rightGripper: state.rightGripper,
    };
  }

  function restoreArmState(snapshot) {
    if (!snapshot) {
      return;
    }
    Object.entries(snapshot).forEach(([joint, value]) => {
      state[joint] = value;
      targets[joint] = value;
    });
  }

  function stopGesture() {
    if (!gesture.active) {
      return;
    }
    restoreArmState(gesture.snapshot);
    gesture.active = false;
    gesture.snapshot = null;
  }

  function startWaveGesture() {
    gesture.snapshot = captureArmState();
    gesture.start = performance.now();
    gesture.active = true;
  }

  function applyWaveGesture(now) {
    const elapsed = now - gesture.start;
    const raiseDuration = 1200;
    const waveDuration = 1800;
    const lowerDuration = 1200;
    const totalDuration = raiseDuration + waveDuration + lowerDuration;
    gesture.duration = totalDuration;
    if (elapsed >= totalDuration) {
      stopGesture();
      return;
    }
    const hold = gesture.snapshot || {};
    const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    const lerp = (a, b, t) => a + (b - a) * t;
    const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);

    const basePose = {
      shoulderRotate: 52,
      elbow: 70,
      gripper: 12,
    };

    let shoulderRotate = basePose.shoulderRotate;
    let elbow = basePose.elbow;
    let gripper = basePose.gripper;

    if (elapsed <= raiseDuration) {
      const t = ease(elapsed / raiseDuration);
      shoulderRotate = lerp(hold.rightShoulderRotate ?? 0, basePose.shoulderRotate, t);
      elbow = lerp(hold.rightElbow ?? 5, basePose.elbow, t);
      gripper = lerp(hold.rightGripper ?? 10, basePose.gripper, t);
    } else if (elapsed <= raiseDuration + waveDuration) {
      const t = (elapsed - raiseDuration) / waveDuration;
      const wave = Math.sin(t * Math.PI * 6);
      const sway = Math.sin(t * Math.PI * 3);
      shoulderRotate = basePose.shoulderRotate + sway * 6;
      elbow = basePose.elbow + wave * 22;
      gripper = basePose.gripper;
    } else {
      const t = smoother((elapsed - raiseDuration - waveDuration) / lowerDuration);
      shoulderRotate = lerp(basePose.shoulderRotate, hold.rightShoulderRotate ?? basePose.shoulderRotate, t);
      elbow = lerp(basePose.elbow, hold.rightElbow ?? basePose.elbow, t);
      gripper = lerp(basePose.gripper, hold.rightGripper ?? basePose.gripper, t);
    }

    targets.leftShoulderLift = hold.leftShoulderLift ?? targets.leftShoulderLift;
    targets.leftShoulderRotate = hold.leftShoulderRotate ?? targets.leftShoulderRotate;
    targets.leftElbow = hold.leftElbow ?? targets.leftElbow;
    targets.leftGripper = hold.leftGripper ?? targets.leftGripper;

    targets.rightShoulderRotate = shoulderRotate;
    targets.rightShoulderLift = hold.rightShoulderLift ?? targets.rightShoulderLift;
    targets.rightElbow = elbow;
    targets.rightGripper = gripper;
  }

  function handleSequenceInput(event) {
    if (event.ctrlKey || event.altKey || event.metaKey) {
      return;
    }
    const target = event.target;
    if (target && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
      return;
    }
    if (!event.key || event.key.length !== 1) {
      return;
    }
    const key = event.key.toLowerCase();
    if (!/[a-z]/.test(key)) {
      return;
    }
    typeBuffer += key;
    if (typeBuffer.length > 6) {
      typeBuffer = typeBuffer.slice(-6);
    }
    if (typeTimer) {
      clearTimeout(typeTimer);
    }
    typeTimer = setTimeout(() => {
      typeBuffer = '';
    }, 1200);

    if (typeBuffer.endsWith('hi')) {
      typeBuffer = '';
      startWaveGesture();
    }
  }

  window.addEventListener('keydown', (event) => {
    handleSequenceInput(event);
    const key = keyName(event);
    if (!['shift', 'a', 'd', 'z', 'c', 'q', 'e', 's'].includes(key)) {
      return;
    }

    if (gesture.active && ['q', 'e', 'a', 'd', 'z', 'c'].includes(key)) {
      stopGesture();
    }

    event.preventDefault();
    if (!pressed.has(key)) {
      pressed.add(key);
      setKeyActive(key, true);
    }

    if (key === 's' && !resetTimer) {
      resetStatus.textContent = 'Holding...';
      resetTimer = setTimeout(() => {
        resetPose();
        clearResetCountdown();
      }, 3000);
    }
  });

  window.addEventListener('keyup', (event) => {
    const key = keyName(event);
    pressed.delete(key);
    setKeyActive(key, false);

    if (key === 's') {
      clearResetCountdown();
      resetStatus.textContent = 'Ready';
    }
  });

  window.addEventListener('blur', () => {
    pressed.forEach((key) => setKeyActive(key, false));
    pressed.clear();
    clearResetCountdown();
    resetStatus.textContent = 'Ready';
    state.baseMotion = 'idle';
  });

  canvas.addEventListener('mousedown', (event) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    stage.classList.add('dragging');
  });

  window.addEventListener('mouseup', () => {
    dragging = false;
    stage.classList.remove('dragging');
  });

  window.addEventListener('mousemove', (event) => {
    if (!dragging) {
      return;
    }
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    viewYaw -= dx * 0.01;
    viewPitch = clamp(viewPitch - dy * 0.006, -0.8, 0.15);
  });

  function loop() {
    const now = performance.now();
    const dt = Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;
    updateMotion();
    if (gesture.active) {
      applyWaveGesture(now);
    }
    Object.entries(config.limits).forEach(([joint]) => {
      const speed = jointSpeeds[joint] || 80;
      const maxDelta = speed * dt;
      state[joint] = moveToward(state[joint], targets[joint], maxDelta);
    });
    draw();
    requestAnimationFrame(loop);
  }

  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(loop);
})();














































