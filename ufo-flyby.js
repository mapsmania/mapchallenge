import * as THREE from 'three';

/**
 * Standalone cab-window event: a flying saucer appears ahead of the train,
 * weaves subtly near the valley/ridge line, and streaks away.
 *
 * Lifecycle API:
 *   start(context)
 *   update(dt, context) -> boolean (returns true while active, false when finished)
 *   dispose()
 */
export class UfoFlybyEvent {
  constructor(options = {}) {
    this.duration = options.duration ?? 11.0; // total seconds for the sighting
    this.scale = options.scale ?? 1.0;
    this.side = options.side ?? (Math.random() < 0.5 ? -1 : 1); // -1 left, +1 right

    this.scene = null;
    this.group = null;
    this.domeMesh = null;
    this.beamCone = null;
    this.ringLights = [];
    this.elapsed = 0;
    this.active = false;

    this._anchor = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._targetPos = new THREE.Vector3();
  }

  _buildCraft() {
    const root = new THREE.Group();
    root.scale.setScalar(this.scale);

    // Metallic disc hull
    const hullMat = new THREE.MeshStandardMaterial({
      color: 0xcbd5e1,
      metalness: 0.85,
      roughness: 0.25
    });
    const trimMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.7,
      roughness: 0.4
    });

    const mainDisc = new THREE.Mesh(
      new THREE.CylinderGeometry(3.2, 6.4, 1.35, 32),
      hullMat
    );
    mainDisc.scale.set(1, 0.55, 1);
    root.add(mainDisc);

    const upperDeck = new THREE.Mesh(
      new THREE.CylinderGeometry(2.1, 3.3, 0.7, 28),
      trimMat
    );
    upperDeck.position.y = 0.42;
    root.add(upperDeck);

    // Translucent glass/energy dome
    const domeMat = new THREE.MeshStandardMaterial({
      color: 0x7dd3fc,
      emissive: 0x0284c7,
      emissiveIntensity: 0.65,
      roughness: 0.1,
      metalness: 0.1,
      transparent: true,
      opacity: 0.78
    });
    this.domeMesh = new THREE.Mesh(
      new THREE.SphereGeometry(2.15, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.55),
      domeMat
    );
    this.domeMesh.position.y = 0.58;
    root.add(this.domeMesh);

    // Orbiting rim lights
    this.ringLights = [];
    const lightCount = 8;
    const bulbGeo = new THREE.SphereGeometry(0.28, 10, 10);
    const palette = [0x38bdf8, 0x34d399, 0xfbbf24, 0xf472b6];

    for (let i = 0; i < lightCount; i++) {
      const angle = (i / lightCount) * Math.PI * 2;
      const bulbMat = new THREE.MeshBasicMaterial({
        color: palette[i % palette.length]
      });
      const bulb = new THREE.Mesh(bulbGeo, bulbMat);
      bulb.position.set(Math.cos(angle) * 5.6, -0.15, Math.sin(angle) * 5.6);
      root.add(bulb);
      this.ringLights.push({ mesh: bulb, phase: i * 0.8 });
    }

    // Optional soft tractor/scan beam pointing downward
    const beamGeo = new THREE.ConeGeometry(3.8, 18, 24, 1, true);
    beamGeo.translate(0, -9.2, 0);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0x67e8f9,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.beamCone = new THREE.Mesh(beamGeo, beamMat);
    root.add(this.beamCone);

    return root;
  }

  /**
   * @param {Object} context
   * @param {THREE.Scene} context.scene
   * @param {THREE.Camera} context.camera
   */
  start(context) {
    this.dispose();
    this.scene = context.scene;
    this.elapsed = 0;
    this.active = true;
    this.group = this._buildCraft();
    this.scene.add(this.group);
    this.update(0, context);
  }

  /**
   * @param {number} dt
   * @param {Object} context
   * @param {THREE.Camera} context.camera
   * @returns {boolean} true while still running, false when complete
   */
  update(dt, context) {
    if (!this.active || !this.group || !context?.camera) return false;

    const clampedDt = Math.min(dt, 0.05);
    this.elapsed += clampedDt;

    const t = THREE.MathUtils.clamp(this.elapsed / this.duration, 0, 1);
    if (this.elapsed >= this.duration) {
      this.dispose();
      return false;
    }

    const { camera } = context;
    camera.getWorldDirection(this._forward);
    this._forward.y = 0;
    if (this._forward.lengthSq() < 1e-6) this._forward.set(0, 0, -1);
    this._forward.normalize();

    this._right.crossVectors(this._forward, this._up).normalize();

    // Flight path relative to a moving anchor ahead of the cab:
    // 0.0 -> 0.25: enters from off-axis ahead
    // 0.25 -> 0.70: hovers & weaves gently above the valley/ridge line
    // 0.70 -> 1.00: accelerates across & away past the cab window
    let lateralOffset;
    let forwardDist;
    let heightOffset;

    if (t < 0.25) {
      const p = t / 0.25;
      const ease = 1 - Math.pow(1 - p, 2);
      lateralOffset = THREE.MathUtils.lerp(this.side * 155, this.side * 42, ease);
      forwardDist = THREE.MathUtils.lerp(240, 155, ease);
      heightOffset = THREE.MathUtils.lerp(42, 22, ease);
    } else if (t < 0.7) {
      const p = (t - 0.25) / 0.45;
      lateralOffset = this.side * (42 - Math.sin(p * Math.PI) * 18);
      forwardDist = 155 - Math.sin(p * Math.PI) * 20;
      heightOffset = 22 + Math.sin(p * Math.PI * 2) * 5.5;
    } else {
      const p = (t - 0.7) / 0.3;
      const accel = p * p;
      lateralOffset = THREE.MathUtils.lerp(this.side * 42, -this.side * 220, accel);
      forwardDist = THREE.MathUtils.lerp(155, 65, accel);
      heightOffset = THREE.MathUtils.lerp(22, 58, accel);
    }

    this._targetPos
      .copy(camera.position)
      .addScaledVector(this._forward, forwardDist)
      .addScaledVector(this._right, lateralOffset);
    this._targetPos.y = Math.max(camera.position.y + heightOffset, this._targetPos.y);

    this.group.position.copy(this._targetPos);

    // Classic saucer spin & subtle bank into turns
    this.group.rotation.y += clampedDt * 2.4;
    this.group.rotation.z = -this.side * Math.sin(t * Math.PI) * 0.16;
    this.group.rotation.x = Math.cos(this.elapsed * 2.1) * 0.06;

    // Pulse rim lights & beam visibility
    for (const item of this.ringLights) {
      const pulse = 0.5 + 0.5 * Math.sin(this.elapsed * 9.0 + item.phase);
      item.mesh.scale.setScalar(0.75 + pulse * 0.55);
    }

    if (this.beamCone) {
      const hoverFactor = t > 0.22 && t < 0.72 ? 1.0 : 0.0;
      this.beamCone.visible = hoverFactor > 0.05;
      this.beamCone.material.opacity = 0.14 * Math.sin(this.elapsed * 4.5) * 0.5 + 0.09;
    }

    return true;
  }

  dispose() {
    this.active = false;
    if (!this.group) return;

    if (this.scene) {
      this.scene.remove(this.group);
    }

    this.group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });

    this.group = null;
    this.domeMesh = null;
    this.beamCone = null;
    this.ringLights = [];
  }
}
