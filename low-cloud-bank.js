import * as THREE from 'three';

function createCloudPuffTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  // Layered soft radial lobes so each sprite reads as billowy mist rather than a hard circle
  const lobes = [
    { x: 64, y: 64, r: 58, a: 0.42 },
    { x: 44, y: 68, r: 42, a: 0.28 },
    { x: 84, y: 66, r: 44, a: 0.28 },
    { x: 64, y: 48, r: 40, a: 0.24 },
    { x: 64, y: 78, r: 38, a: 0.22 }
  ];

  for (const lobe of lobes) {
    const grad = ctx.createRadialGradient(
      lobe.x,
      lobe.y,
      lobe.r * 0.08,
      lobe.x,
      lobe.y,
      lobe.r
    );
    grad.addColorStop(0.0, `rgba(248, 250, 252, ${lobe.a})`);
    grad.addColorStop(0.55, `rgba(226, 232, 240, ${lobe.a * 0.55})`);
    grad.addColorStop(1.0, 'rgba(226, 232, 240, 0.0)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(lobe.x, lobe.y, lobe.r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Atmospheric cab-window event: a low cloud / valley mist bank drifts across
 * a slope or basin ahead of the train, hugging terrain elevation and fading cleanly.
 *
 * Lifecycle API:
 *   start(context)
 *   update(dt, context) -> boolean (returns true while active, false when finished)
 *   dispose()
 */
export class LowCloudBankEvent {
  constructor(options = {}) {
    this.duration = options.duration ?? 14.0;
    this.puffCount = options.puffCount ?? 48;
    this.bankWidth = options.bankWidth ?? 220;
    this.bankDepth = options.bankDepth ?? 95;
    this.heightOffset = options.heightOffset ?? 14;
    this.driftSpeed = options.driftSpeed ?? 7.5;
    this.side = options.side ?? (Math.random() < 0.5 ? -1 : 1); // drift direction across view
    this.color = options.color ?? 0xe8eef5;
    this.maxOpacity = options.maxOpacity ?? 0.34;

    this.scene = null;
    this.getGroundHeight = null;
    this.group = null;
    this.texture = null;
    this.puffs = [];
    this.elapsed = 0;
    this.started = false;
    this.finished = false;

    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._driftVec = new THREE.Vector3();
  }

  _sampleGround(x, z) {
    if (typeof this.getGroundHeight === 'function') {
      return this.getGroundHeight(x, z);
    }
    return 0;
  }

  _envelope(t) {
    // Smooth fade-in over first 22%, hold, smooth fade-out over last 28%
    const fadeIn = THREE.MathUtils.smoothstep(t, 0.0, 0.22);
    const fadeOut = 1.0 - THREE.MathUtils.smoothstep(t, 0.72, 1.0);
    return THREE.MathUtils.clamp(fadeIn * fadeOut, 0, 1);
  }

  /**
   * @param {Object} context
   * @param {THREE.Scene} context.scene
   * @param {THREE.Camera} context.camera
   * @param {Function} [context.getGroundHeight] (x, z) => number
   */
  start({ scene, camera, getGroundHeight }) {
    this.dispose();

    this.scene = scene;
    this.getGroundHeight = getGroundHeight || null;
    this.elapsed = 0;
    this.started = true;
    this.finished = false;
    this.puffs = [];

    this.group = new THREE.Group();
    this.group.name = 'LowCloudBankEvent';
    this.texture = createCloudPuffTexture();

    camera.getWorldDirection(this._forward);
    this._forward.y = 0;
    if (this._forward.lengthSq() < 1e-6) this._forward.set(0, 0, -1);
    this._forward.normalize();

    this._right.crossVectors(this._forward, this._up).normalize();

    // Drift laterally across the valley/slope in front of the cab
    this._driftVec.copy(this._right).multiplyScalar(this.side * this.driftSpeed);

    // Anchor the cloud bank ahead of the cab and slightly upwind so it sweeps across view
    const anchorCenter = camera.position
      .clone()
      .addScaledVector(this._forward, 135)
      .addScaledVector(this._right, -this.side * 45);

    for (let i = 0; i < this.puffCount; i++) {
      // Deterministic-ish distribution with organic jitter
      const u = ((i * 0.61803398875) % 1) - 0.5; // golden-ratio spread across width
      const v = Math.sin(i * 4.712 + 0.5) * 0.5;
      const layer = i % 3; // 0 = low mist, 1 = mid bank, 2 = upper wisps

      const offsetRight = u * this.bankWidth;
      const offsetForward = v * this.bankDepth;

      const worldX =
        anchorCenter.x +
        this._right.x * offsetRight +
        this._forward.x * offsetForward;
      const worldZ =
        anchorCenter.z +
        this._right.z * offsetRight +
        this._forward.z * offsetForward;

      const groundY = this._sampleGround(worldX, worldZ);
      const layerLift = this.heightOffset + layer * 10 + ((i * 7) % 9) * 1.4;
      const worldY = groundY + layerLift;

      const baseScaleX = 48 + ((i * 13) % 34);
      const baseScaleY = 20 + ((i * 11) % 16);
      const puffOpacityScale = layer === 0 ? 1.0 : layer === 1 ? 0.82 : 0.58;

      const material = new THREE.SpriteMaterial({
        map: this.texture,
        color: this.color,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        fog: true
      });

      const sprite = new THREE.Sprite(material);
      sprite.position.set(worldX, worldY, worldZ);
      sprite.scale.set(baseScaleX, baseScaleY, 1);
      sprite.renderOrder = 2;

      this.group.add(sprite);
      this.puffs.push({
        sprite,
        material,
        baseScaleX,
        baseScaleY,
        layerLift,
        puffOpacityScale,
        phase: i * 1.37,
        bobAmp: 1.4 + (i % 4) * 0.55,
        bobSpeed: 0.45 + (i % 3) * 0.15,
        driftFactor: 0.82 + ((i * 5) % 6) * 0.08
      });
    }

    scene.add(this.group);
    return true;
  }

  /**
   * @param {number} dt
   * @returns {boolean} true while active, false when finished
   */
  update(dt) {
    if (!this.started || this.finished || !this.group) return false;

    const stepDt = Math.min(dt, 0.05);
    this.elapsed += stepDt;

    if (this.elapsed >= this.duration) {
      this.dispose();
      return false;
    }

    const t = this.elapsed / this.duration;
    const env = this._envelope(t);

    for (const p of this.puffs) {
      const pos = p.sprite.position;

      // Drift across the valley/ridge
      pos.x += this._driftVec.x * p.driftFactor * stepDt;
      pos.z += this._driftVec.z * p.driftFactor * stepDt;

      // Re-sample ground height so the mist bank hugs terrain contours as it moves
      const groundY = this._sampleGround(pos.x, pos.z);
      const bob = Math.sin(this.elapsed * p.bobSpeed + p.phase) * p.bobAmp;
      pos.y = groundY + p.layerLift + bob;

      // Gentle swell as the bank rolls
      const swell = 1.0 + Math.sin(this.elapsed * 0.35 + p.phase) * 0.08;
      p.sprite.scale.set(p.baseScaleX * swell, p.baseScaleY * swell, 1);

      p.material.opacity = this.maxOpacity * env * p.puffOpacityScale;
    }

    return true;
  }

  dispose() {
    if (this.finished) return;
    this.finished = true;
    this.started = false;

    for (const p of this.puffs) {
      if (p.material) p.material.dispose();
    }
    this.puffs.length = 0;

    if (this.group && this.scene) {
      this.scene.remove(this.group);
    }
    this.group = null;

    if (this.texture) {
      this.texture.dispose();
      this.texture = null;
    }
  }
}
