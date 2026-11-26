import * as THREE from 'three';

/**
 * A flock of birds startled by the passing train.
 *
 * API matches the route-event classes used by the train simulator:
 *   const event = new BirdStrikeEvent({ duration: 8, count: 14, side: 1 });
 *   event.start({ scene, camera, getGroundHeight, progress, speedKmh, direction });
 *   event.update(dt, { scene, camera, progress, speedKmh, direction });
 *   event.dispose();
 */
export class BirdStrikeEvent {
  constructor(options = {}) {
    this.duration = options.duration ?? 8;
    this.count = options.count ?? 14;
    this.side = options.side ?? 1; // 1 = right of train, -1 = left
    this.spread = options.spread ?? 8;
    this.elapsed = 0;
    this.started = false;
    this.finished = false;
    this.birds = [];
    this.group = null;

    this.tailGeometry = new THREE.ConeGeometry(0.09, 0.22, 4);
    this.bodyGeometry = new THREE.SphereGeometry(1, 8, 6);
    this.wingGeometry = this.createWingGeometry();
    this.bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0x292d2b,
      roughness: 0.9,
      side: THREE.DoubleSide
    });
    this.wingMaterial = new THREE.MeshStandardMaterial({
      color: 0x1e2321,
      roughness: 0.85,
      side: THREE.DoubleSide
    });
  }

  createWingGeometry() {
    // Wing spans outward along -X from shoulder (0, 0, 0) to tip (-0.82, 0, 0),
    // with chord along Z so rotating around Z flaps the wingtip up and down.
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0.0, 0.0, -0.11,   // 0: inner leading edge
      0.0, 0.0,  0.14,   // 1: inner trailing edge
     -0.42, 0.02, -0.14,  // 2: mid leading edge
     -0.42, 0.0,   0.16,  // 3: mid trailing edge
     -0.82, 0.03, -0.04,  // 4: outer wingtip
     -0.74, 0.01,  0.07   // 5: outer trailing tip
    ], 3));
    geometry.setIndex([
      0, 2, 3, 0, 3, 1,
      2, 4, 5, 2, 5, 3
    ]);
    geometry.computeVertexNormals();
    return geometry;
  }

  makeBird(phase, flapSpeed, baseScale) {
    const bird = new THREE.Group();

    // Body aligned along -Z (forward in Three.js)
    const body = new THREE.Mesh(this.bodyGeometry, this.bodyMaterial);
    body.scale.set(0.12, 0.12, 0.34);
    bird.add(body);

    // Left wing extends along -X; positive Z rotation lifts the -X tip upward (+Y)
    const leftPivot = new THREE.Group();
    leftPivot.position.set(-0.08, 0.03, -0.02);
    const leftWing = new THREE.Mesh(this.wingGeometry, this.wingMaterial);
    leftPivot.add(leftWing);
    bird.add(leftPivot);

    // Right wing mirrored along +X; negative Z rotation lifts the +X tip upward (+Y)
    const rightPivot = new THREE.Group();
    rightPivot.position.set(0.08, 0.03, -0.02);
    const rightWing = new THREE.Mesh(this.wingGeometry, this.wingMaterial);
    rightWing.scale.x = -1;
    rightPivot.add(rightWing);
    bird.add(rightPivot);

    const tail = new THREE.Mesh(this.tailGeometry, this.wingMaterial);
    tail.rotation.x = Math.PI / 2;
    tail.position.z = 0.26;
    bird.add(tail);

    bird.scale.setScalar(baseScale);

    bird.traverse(object => {
      if (object.isMesh) {
        object.castShadow = false;
        object.receiveShadow = false;
      }
    });

    return { bird, leftPivot, rightPivot, phase, flapSpeed, baseScale };
  }

  start({ scene, camera, getGroundHeight }) {
    if (this.started) return;

    this.started = true;
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'BirdStrikeEvent';

    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
    forward.normalize();

    const right = new THREE.Vector3(-forward.z, 0, forward.x)
      .normalize()
      .multiplyScalar(this.side);

    const origin = camera.position.clone()
      .addScaledVector(forward, 24)
      .addScaledVector(right, 10);

    const groundY = typeof getGroundHeight === 'function'
      ? getGroundHeight(origin.x, origin.z)
      : camera.position.y - 4;
    origin.y = Math.max(groundY + 1.6, camera.position.y - 0.8);

    for (let i = 0; i < this.count; i++) {
      const phase = i * 1.73 + Math.random() * 1.4;
      const flapSpeed = 11.5 + (i % 5) * 1.6 + Math.random() * 1.5;
      const baseScale = 0.75 + ((i * 7) % 6) * 0.1;

      const item = this.makeBird(phase, flapSpeed, baseScale);

      const spreadRight =
        (Math.sin(i * 12.37) * 0.5 + Math.cos(i * 3.1) * 0.5) * this.spread;
      const spreadForward =
        (Math.cos(i * 8.17) * 0.5 + Math.sin(i * 5.4) * 0.5) * this.spread * 0.6;
      const spreadY = ((i % 5) - 2) * 0.65;

      item.bird.position.copy(origin)
        .addScaledVector(right, spreadRight)
        .addScaledVector(forward, spreadForward);
      item.bird.position.y += spreadY;

      // Distinct initial velocities so each bird takes its own line
      const outwardSpeed = 1.6 + (i % 5) * 0.75 + Math.random() * 0.8;
      const forwardSpeed = 2.5 + (i % 4) * 1.1 + Math.random() * 1.2;
      const climbSpeed = 1.4 + (i % 6) * 0.45;

      item.velocity = right.clone().multiplyScalar(outwardSpeed)
        .addScaledVector(forward, forwardSpeed);
      item.velocity.y = climbSpeed;

      // Individual steering/flutter parameters
      item.turnRate = ((i % 2 === 0 ? 1 : -1) * (0.35 + (i % 4) * 0.18));
      item.liftAmp = 0.6 + (i % 3) * 0.35;
      item.liftFreq = 2.0 + (i % 4) * 0.45;

      item.bird.lookAt(item.bird.position.clone().add(item.velocity));

      this.group.add(item.bird);
      this.birds.push(item);
    }

    scene.add(this.group);
  }

  update(dt) {
    if (!this.started || this.finished) return false;

    const stepDt = Math.min(dt, 0.05);
    this.elapsed += stepDt;

    const t = Math.min(this.elapsed / this.duration, 1);
    const fade = t > 0.72 ? 1 - (t - 0.72) / 0.28 : 1;

    const upAxis = new THREE.Vector3(0, 1, 0);
    const lookTarget = new THREE.Vector3();

    for (const item of this.birds) {
      // Gently curve each bird's horizontal velocity independently
      item.velocity.applyAxisAngle(upAxis, item.turnRate * stepDt);

      // Individual wave/climb oscillation
      const waveY =
        Math.cos(this.elapsed * item.liftFreq + item.phase) * item.liftAmp;

      item.bird.position.x += item.velocity.x * stepDt;
      item.bird.position.z += item.velocity.z * stepDt;
      item.bird.position.y += (item.velocity.y + waveY) * stepDt;

      // Face along current movement direction
      lookTarget.copy(item.bird.position).add(item.velocity);
      item.bird.lookAt(lookTarget);

      // Wing flap: broad upstroke, slightly snappier downstroke
      const cycle = this.elapsed * item.flapSpeed + item.phase;
      const flapAngle = Math.sin(cycle) * 0.68 + Math.sin(cycle * 2) * 0.1;

      item.leftPivot.rotation.z = flapAngle;
      item.rightPivot.rotation.z = -flapAngle;

      // Preserve per-bird scale while fading out at the end
      item.bird.scale.setScalar(Math.max(0.001, item.baseScale * fade));
    }

    if (this.elapsed >= this.duration) {
      this.dispose();
      return false;
    }

    return true;
  }

  dispose() {
    if (this.finished) return;

    this.finished = true;

    if (this.group && this.scene) {
      this.scene.remove(this.group);
    }

    this.birds.length = 0;
    this.group = null;

    this.bodyGeometry.dispose();
    this.wingGeometry.dispose();
    this.tailGeometry.dispose();
    this.bodyMaterial.dispose();
    this.wingMaterial.dispose();
  }
}
