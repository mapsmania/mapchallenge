import * as THREE from 'three';

function createDustTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');

  const grad = ctx.createRadialGradient(16, 16, 1, 16, 16, 15);
  grad.addColorStop(0.0, 'rgba(214, 206, 194, 0.85)');
  grad.addColorStop(0.6, 'rgba(180, 172, 160, 0.35)');
  grad.addColorStop(1.0, 'rgba(180, 172, 160, 0.0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 32, 32);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Standalone cab-window event: a large boulder spawns upslope ahead of the cab,
 * rolls downhill along the terrain gradient with trailing dust, and cleans up.
 *
 * Lifecycle API:
 *   start(context)
 *   update(dt, context) -> boolean (returns true while active, false when finished)
 *   dispose()
 */
export class RollingBoulderEvent {
  constructor(options = {}) {
    this.radius = options.radius ?? 4.2;
    this.duration = options.duration ?? 12.0;
    this.side = options.side ?? (Math.random() < 0.5 ? -1 : 1); // -1 left, +1 right
    this.gravity = options.gravity ?? 26.0;
    this.drag = options.drag ?? 0.35;
    this.dustCount = options.dustCount ?? 220;

    this.scene = null;
    this.getGroundHeight = null;
    this.mesh = null;
    this.dustPoints = null;
    this.dustGeometry = null;
    this.dustMaterial = null;
    this.dustTexture = null;
    this.dustPositions = null;
    this.dustAges = null;

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.elapsed = 0;
    this.active = false;
    this.dustCursor = 0;

    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._stepDelta = new THREE.Vector3();
    this._rollAxis = new THREE.Vector3();
    this._rollQuat = new THREE.Quaternion();
  }

  _buildBoulderGeometry() {
    const geo = new THREE.IcosahedronGeometry(this.radius, 2);
    const pos = geo.attributes.position;
    const v = new THREE.Vector3();

    // Deterministic craggy rock displacement
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n =
        Math.sin(v.x * 1.35 + 0.4) *
        Math.cos(v.y * 1.45 - 0.7) *
        Math.sin(v.z * 1.3 + 1.1);
      const scale = 1.0 + n * 0.22;
      v.multiplyScalar(scale);
      pos.setXYZ(i, v.x, v.y, v.z);
    }

    geo.computeVertexNormals();
    return geo;
  }

  _buildDustSystem() {
    this.dustPositions = new Float32Array(this.dustCount * 3);
    this.dustAges = new Float32Array(this.dustCount);
    this.dustAges.fill(999);

    this.dustGeometry = new THREE.BufferGeometry();
    this.dustGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.dustPositions, 3)
    );

    this.dustTexture = createDustTexture();
    this.dustMaterial = new THREE.PointsMaterial({
      map: this.dustTexture,
      size: this.radius * 1.9,
      color: 0xd6cec2,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
      sizeAttenuation: true
    });

    this.dustPoints = new THREE.Points(this.dustGeometry, this.dustMaterial);
    this.dustPoints.frustumCulled = false;
  }

  _sampleGround(x, z) {
    if (typeof this.getGroundHeight === 'function') {
      return this.getGroundHeight(x, z);
    }
    return 0;
  }

  _spawnDustPuff(x, y, z) {
    const idx = this.dustCursor;
    const i3 = idx * 3;
    this.dustPositions[i3] = x + (Math.random() - 0.5) * this.radius * 0.8;
    this.dustPositions[i3 + 1] = y + (Math.random() * 0.6);
    this.dustPositions[i3 + 2] = z + (Math.random() - 0.5) * this.radius * 0.8;
    this.dustAges[idx] = 0.0;
    this.dustCursor = (this.dustCursor + 1) % this.dustCount;
  }

  /**
   * @param {Object} context
   * @param {THREE.Scene} context.scene
   * @param {THREE.Camera} context.camera
   * @param {Function} [context.getGroundHeight] (x, z) => number
   */
  start(context) {
    this.dispose();
    this.scene = context.scene;
    this.getGroundHeight = context.getGroundHeight || null;
    this.elapsed = 0;
    this.active = true;

    const { camera } = context;
    camera.getWorldDirection(this._forward);
    this._forward.y = 0;
    if (this._forward.lengthSq() < 1e-6) this._forward.set(0, 0, -1);
    this._forward.normalize();
    this._right.crossVectors(this._forward, this._up).normalize();

    // Start ahead and slightly to one side so it rolls into/across the cab's view
    const startForward = 145;
    const startLateral = this.side * 55;
    const startX =
      camera.position.x +
      this._forward.x * startForward +
      this._right.x * startLateral;
    const startZ =
      camera.position.z +
      this._forward.z * startForward +
      this._right.z * startLateral;

    // Pick whichever adjacent sample (inward toward valley or slightly ahead) is higher as start
    const sampleStep = 14;
    const hCenter = this._sampleGround(startX, startZ);
    const hOutward = this._sampleGround(
      startX + this._right.x * this.side * sampleStep,
      startZ + this._right.z * this.side * sampleStep
    );
    const hAhead = this._sampleGround(
      startX + this._forward.x * sampleStep,
      startZ + this._forward.z * sampleStep
    );

    let spawnX = startX;
    let spawnZ = startZ;
    let spawnY = hCenter;
    if (hOutward > spawnY + 2.5) {
      spawnX = startX + this._right.x * this.side * sampleStep;
      spawnZ = startZ + this._right.z * this.side * sampleStep;
      spawnY = hOutward;
    } else if (hAhead > spawnY + 2.5) {
      spawnX = startX + this._forward.x * sampleStep;
      spawnZ = startZ + this._forward.z * sampleStep;
      spawnY = hAhead;
    }

    this.pos.set(spawnX, spawnY + this.radius, spawnZ);
    this.vel.set(0, 0, 0);

    const boulderMat = new THREE.MeshStandardMaterial({
      color: 0x78716c,
      roughness: 0.94,
      metalness: 0.04,
      flatShading: true
    });

    this.mesh = new THREE.Mesh(this._buildBoulderGeometry(), boulderMat);
    this.mesh.position.copy(this.pos);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.scene.add(this.mesh);

    this._buildDustSystem();
    this.scene.add(this.dustPoints);

    return true;
  }

  /**
   * @param {number} dt
   * @param {Object} context
   * @returns {boolean} true while active, false when finished
   */
  update(dt, context) {
    if (!this.active || !this.mesh) return false;

    const clampedDt = Math.min(dt, 0.05);
    this.elapsed += clampedDt;

    if (this.elapsed >= this.duration) {
      this.dispose();
      return false;
    }

    const eps = 3.0;
    const hL = this._sampleGround(this.pos.x - eps, this.pos.z);
    const hR = this._sampleGround(this.pos.x + eps, this.pos.z);
    const hD = this._sampleGround(this.pos.x, this.pos.z - eps);
    const hU = this._sampleGround(this.pos.x, this.pos.z + eps);

    // Terrain gradient: -dH/dX points downhill in X, -dH/dZ points downhill in Z
    const gradX = -(hR - hL) / (2 * eps);
    const gradZ = -(hU - hD) / (2 * eps);
    const slopeMag = Math.hypot(gradX, gradZ);

    // Downhill acceleration (gentle cap on flat valley floors so it doesn't shoot off)
    const slopeFactor = THREE.MathUtils.clamp(slopeMag, 0.04, 1.15);
    this.vel.x += gradX * this.gravity * slopeFactor * clampedDt;
    this.vel.z += gradZ * this.gravity * slopeFactor * clampedDt;

    const damping = Math.exp(-this.drag * clampedDt);
    this.vel.x *= damping;
    this.vel.z *= damping;

    const prevX = this.pos.x;
    const prevZ = this.pos.z;

    this.pos.x += this.vel.x * clampedDt;
    this.pos.z += this.vel.z * clampedDt;

    const groundY = this._sampleGround(this.pos.x, this.pos.z);
    const targetY = groundY + this.radius;

    // Slight bounce if terrain drops sharply beneath the boulder
    if (this.pos.y > targetY + 0.15) {
      this.vel.y -= this.gravity * 0.65 * clampedDt;
      this.pos.y = Math.max(targetY, this.pos.y + this.vel.y * clampedDt);
    } else {
      this.vel.y = 0;
      this.pos.y = targetY;
    }

    this.mesh.position.copy(this.pos);

    // Rotate boulder around horizontal axis perpendicular to horizontal travel
    const dx = this.pos.x - prevX;
    const dz = this.pos.z - prevZ;
    const horizDist = Math.hypot(dx, dz);
    if (horizDist > 1e-5) {
      this._stepDelta.set(dx, 0, dz).normalize();
      this._rollAxis.crossVectors(this._up, this._stepDelta).normalize();
      const angle = horizDist / this.radius;
      this._rollQuat.setFromAxisAngle(this._rollAxis, angle);
      this.mesh.quaternion.premultiply(this._rollQuat);
    }

    // Spawn dust puffs when rolling and drift existing dust upward/outward
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (speed > 1.5 && Math.random() < THREE.MathUtils.clamp(speed / 18, 0.15, 0.85)) {
      this._spawnDustPuff(this.pos.x, groundY + 0.6, this.pos.z);
    }

    const maxDustAge = 2.4;
    for (let i = 0; i < this.dustCount; i++) {
      if (this.dustAges[i] < maxDustAge) {
        this.dustAges[i] += clampedDt;
        const i3 = i * 3;
        this.dustPositions[i3 + 1] += 1.1 * clampedDt;
        this.dustPositions[i3] += 0.4 * clampedDt;
      }
    }
    this.dustGeometry.attributes.position.needsUpdate = true;

    // Fade out gently near the end of duration
    const remaining = this.duration - this.elapsed;
    if (remaining < 1.2) {
      this.dustMaterial.opacity = THREE.MathUtils.clamp((remaining / 1.2) * 0.48, 0, 0.48);
    }

    return true;
  }

  dispose() {
    this.active = false;

    if (this.mesh) {
      if (this.scene) this.scene.remove(this.mesh);
      this.mesh.geometry?.dispose();
      this.mesh.material?.dispose();
      this.mesh = null;
    }

    if (this.dustPoints) {
      if (this.scene) this.scene.remove(this.dustPoints);
      this.dustGeometry?.dispose();
      this.dustMaterial?.dispose();
      this.dustTexture?.dispose();
      this.dustPoints = null;
      this.dustGeometry = null;
      this.dustMaterial = null;
      this.dustTexture = null;
    }

    this.dustPositions = null;
    this.dustAges = null;
  }
}
