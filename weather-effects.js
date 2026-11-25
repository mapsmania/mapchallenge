import * as THREE from 'three';

function createRainTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');

  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0.0, 'rgba(200, 225, 255, 0.0)');
  grad.addColorStop(0.35, 'rgba(200, 225, 255, 0.45)');
  grad.addColorStop(1.0, 'rgba(235, 245, 255, 0.9)');

  ctx.fillStyle = grad;
  ctx.fillRect(6, 0, 4, canvas.height);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createSnowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');

  const grad = ctx.createRadialGradient(16, 16, 1, 16, 16, 15);
  grad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
  grad.addColorStop(0.55, 'rgba(241, 245, 249, 0.75)');
  grad.addColorStop(1.0, 'rgba(241, 245, 249, 0.0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 32, 32);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class WeatherEffects {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   * @param {Object} [options]
   * @param {THREE.Light} [options.sunLight]
   * @param {number} [options.rainCount=4500]
   * @param {number} [options.snowCount=3500]
   * @param {number} [options.boxWidth=70]
   * @param {number} [options.boxHeight=36]
   * @param {number} [options.boxDepth=70]
   */
  constructor(scene, camera, options = {}) {
    this.scene = scene;
    this.camera = camera;
    this.sunLight = options.sunLight || null;

    this.boxWidth = options.boxWidth ?? 70;
    this.boxHeight = options.boxHeight ?? 36;
    this.boxDepth = options.boxDepth ?? 70;

    this.mode = 'clear'; // 'clear' | 'rain' | 'snow'
    this.intensity = 0.75; // 0.0 .. 1.0
    this.wind = new THREE.Vector3(1.8, 0, 0.7);
    this.elapsed = 0;

    this.baseFogColor = scene.fog?.color ? scene.fog.color.clone() : new THREE.Color(0x9ec5e6);
    this.baseFogDensity = scene.fog?.density ?? 0.00011;
    this.baseBgColor = scene.background instanceof THREE.Color
      ? scene.background.clone()
      : new THREE.Color(0x9ec5e6);
    this.baseSunIntensity = this.sunLight ? this.sunLight.intensity : 2.0;

    this._rain = this._createParticleSystem({
      count: options.rainCount ?? 4500,
      texture: createRainTexture(),
      size: 1.35,
      opacity: 0.55,
      color: 0xcbd5e1
    });

    this._snow = this._createParticleSystem({
      count: options.snowCount ?? 3500,
      texture: createSnowTexture(),
      size: 0.65,
      opacity: 0.85,
      color: 0xf8fafc
    });

    this._rain.points.visible = false;
    this._snow.points.visible = false;

    this.scene.add(this._rain.points);
    this.scene.add(this._snow.points);

    this._tmpForward = new THREE.Vector3();
    this._tmpRight = new THREE.Vector3();
    this._tmpUp = new THREE.Vector3(0, 1, 0);
  }

  _createParticleSystem({ count, texture, size, opacity, color }) {
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      positions[i3] = (Math.random() - 0.5) * this.boxWidth;
      positions[i3 + 1] = (Math.random() - 0.5) * this.boxHeight;
      positions[i3 + 2] = (Math.random() - 0.5) * this.boxDepth;

      seeds[i3] = Math.random() * Math.PI * 2; // phase
      seeds[i3 + 1] = 0.7 + Math.random() * 0.6; // speed scale
      seeds[i3 + 2] = Math.random(); // lateral drift bias
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      map: texture,
      size,
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.NormalBlending,
      sizeAttenuation: true
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;

    return { count, positions, seeds, geometry, material, texture, points };
  }

  /**
   * Set active weather mode.
   * @param {'clear'|'rain'|'snow'} mode
   * @param {number} [intensity]
   */
  setWeather(mode, intensity = this.intensity) {
    if (!['clear', 'rain', 'snow'].includes(mode)) return;
    this.mode = mode;
    this.intensity = THREE.MathUtils.clamp(intensity, 0.05, 1.0);

    this._rain.points.visible = mode === 'rain';
    this._snow.points.visible = mode === 'snow';

    this._applyAtmosphere();
  }

  setIntensity(intensity) {
    this.intensity = THREE.MathUtils.clamp(intensity, 0.05, 1.0);
    this._applyAtmosphere();
  }

  _applyAtmosphere() {
    if (!this.scene.fog) return;

    const fogColor = this.scene.fog.color;
    const bgColor = this.scene.background instanceof THREE.Color ? this.scene.background : null;

    if (this.mode === 'clear') {
      fogColor.copy(this.baseFogColor);
      if (bgColor) bgColor.copy(this.baseBgColor);
      this.scene.fog.density = this.baseFogDensity;
      if (this.sunLight) this.sunLight.intensity = this.baseSunIntensity;
    } else if (this.mode === 'rain') {
      const stormTint = new THREE.Color(0x64748b);
      fogColor.copy(this.baseFogColor).lerp(stormTint, 0.65 * this.intensity);
      if (bgColor) bgColor.copy(fogColor);
      this.scene.fog.density = this.baseFogDensity + 0.00055 * this.intensity;
      if (this.sunLight) {
        this.sunLight.intensity = this.baseSunIntensity * (1 - 0.55 * this.intensity);
      }
    } else if (this.mode === 'snow') {
      const snowTint = new THREE.Color(0xcbd5e1);
      fogColor.copy(this.baseFogColor).lerp(snowTint, 0.5 * this.intensity);
      if (bgColor) bgColor.copy(fogColor);
      this.scene.fog.density = this.baseFogDensity + 0.00045 * this.intensity;
      if (this.sunLight) {
        this.sunLight.intensity = this.baseSunIntensity * (1 - 0.35 * this.intensity);
      }
    }
  }

  _wrapCoord(val, halfExtent) {
    const span = halfExtent * 2;
    if (val > halfExtent) return val - span;
    if (val < -halfExtent) return val + span;
    return val;
  }

  /**
   * Call once per frame inside animate(now).
   * @param {number} dt Delta time in seconds
   * @param {Object} [motion]
   * @param {number} [motion.speedKmh=0] Current train speed in km/h
   * @param {number} [motion.direction=1] 1 for forward, -1 for reverse
   */
  update(dt, { speedKmh = 0, direction = 1 } = {}) {
    if (this.mode === 'clear') return;

    const clampedDt = Math.min(dt, 0.05);
    this.elapsed += clampedDt;

    this.camera.getWorldDirection(this._tmpForward);
    this._tmpForward.y = 0;
    if (this._tmpForward.lengthSq() < 1e-6) this._tmpForward.set(0, 0, -1);
    this._tmpForward.normalize();

    this._tmpRight.crossVectors(this._tmpForward, this._tmpUp).normalize();

    const trainSpeedMps = (Math.max(0, speedKmh) / 3.6) * direction;
    const halfX = this.boxWidth * 0.5;
    const halfY = this.boxHeight * 0.5;
    const halfZ = this.boxDepth * 0.5;

    if (this.mode === 'rain') {
      const { count, positions, seeds, geometry, material } = this._rain;
      const activeCount = Math.max(100, Math.floor(count * this.intensity));
      geometry.setDrawRange(0, activeCount);
      material.opacity = THREE.MathUtils.clamp(0.25 + this.intensity * 0.45, 0.2, 0.72);
      material.size = 1.15 + this.intensity * 0.45;

      const baseFallSpeed = 24 + this.intensity * 10;

      for (let i = 0; i < activeCount; i++) {
        const i3 = i * 3;
        const speedScale = seeds[i3 + 1];

        let x = positions[i3];
        let y = positions[i3 + 1];
        let z = positions[i3 + 2];

        // Relative velocity: rain falls fast + wind + apparent motion opposite to train travel
        const vx = this.wind.x * speedScale - this._tmpForward.x * trainSpeedMps * 0.45;
        const vy = -baseFallSpeed * speedScale;
        const vz = this.wind.z * speedScale - this._tmpForward.z * trainSpeedMps * 0.45;

        x = this._wrapCoord(x + vx * clampedDt, halfX);
        y = this._wrapCoord(y + vy * clampedDt, halfY);
        z = this._wrapCoord(z + vz * clampedDt, halfZ);

        positions[i3] = x;
        positions[i3 + 1] = y;
        positions[i3 + 2] = z;
      }

      geometry.attributes.position.needsUpdate = true;
      this._rain.points.position.copy(this.camera.position);
    } else if (this.mode === 'snow') {
      const { count, positions, seeds, geometry, material } = this._snow;
      const activeCount = Math.max(100, Math.floor(count * this.intensity));
      geometry.setDrawRange(0, activeCount);
      material.opacity = THREE.MathUtils.clamp(0.45 + this.intensity * 0.45, 0.35, 0.92);
      material.size = 0.52 + this.intensity * 0.28;

      const baseFallSpeed = 2.6 + this.intensity * 1.4;

      for (let i = 0; i < activeCount; i++) {
        const i3 = i * 3;
        const phase = seeds[i3];
        const speedScale = seeds[i3 + 1];

        const sway = Math.sin(this.elapsed * 1.4 + phase) * 1.35;
        const flutter = Math.cos(this.elapsed * 1.1 + phase * 1.7) * 0.75;

        let x = positions[i3];
        let y = positions[i3 + 1];
        let z = positions[i3 + 2];

        const vx =
          this._tmpRight.x * sway +
          this.wind.x * 0.55 * speedScale -
          this._tmpForward.x * trainSpeedMps * 0.35;
        const vy = -baseFallSpeed * speedScale;
        const vz =
          this._tmpRight.z * sway +
          flutter +
          this.wind.z * 0.55 * speedScale -
          this._tmpForward.z * trainSpeedMps * 0.35;

        x = this._wrapCoord(x + vx * clampedDt, halfX);
        y = this._wrapCoord(y + vy * clampedDt, halfY);
        z = this._wrapCoord(z + vz * clampedDt, halfZ);

        positions[i3] = x;
        positions[i3 + 1] = y;
        positions[i3 + 2] = z;
      }

      geometry.attributes.position.needsUpdate = true;
      this._snow.points.position.copy(this.camera.position);
    }
  }

  dispose() {
    this.scene.remove(this._rain.points);
    this.scene.remove(this._snow.points);

    this._rain.geometry.dispose();
    this._rain.material.dispose();
    this._rain.texture.dispose();

    this._snow.geometry.dispose();
    this._snow.material.dispose();
    this._snow.texture.dispose();

    this._applyAtmosphere();
  }
}
