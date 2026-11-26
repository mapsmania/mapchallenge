import * as THREE from 'three';

export class BirdStrikeEvent {
  constructor(options = {}) {
    this.duration = options.duration ?? 8;
    this.count = options.count ?? 20;
    this.side = options.side ?? 1;
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
    const geometry = new THREE.BufferGeometry();

    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([
        0.0, 0.0, -0.11,
        0.0, 0.0,  0.14,
       -0.42, 0.02, -0.14,
       -0.42, 0.0,   0.16,
       -0.82, 0.03, -0.04,
       -0.74, 0.01,  0.07
      ], 3)
    );

    geometry.setIndex([
      0, 2, 3, 0, 3, 1,
      2, 4, 5, 2, 5, 3
    ]);

    geometry.computeVertexNormals();

    return geometry;
  }

  makeBird(phase, flapSpeed, baseScale) {
    const bird = new THREE.Group();

    // Body points along local -Z.
    const body = new THREE.Mesh(
      this.bodyGeometry,
      this.bodyMaterial
    );

    body.scale.set(0.12, 0.12, 0.34);
    bird.add(body);

    // Left wing.
    const leftPivot = new THREE.Group();
    leftPivot.position.set(-0.08, 0.03, -0.02);

    const leftWing = new THREE.Mesh(
      this.wingGeometry,
      this.wingMaterial
    );

    leftPivot.add(leftWing);
    bird.add(leftPivot);

    // Right wing, mirrored.
    const rightPivot = new THREE.Group();
    rightPivot.position.set(0.08, 0.03, -0.02);

    const rightWing = new THREE.Mesh(
      this.wingGeometry,
      this.wingMaterial
    );

    rightWing.scale.x = -1;
    rightPivot.add(rightWing);
    bird.add(rightPivot);

    // Tail.
    const tail = new THREE.Mesh(
      this.tailGeometry,
      this.wingMaterial
    );

    tail.rotation.x = Math.PI / 2;
    tail.position.z = 0.26;
    bird.add(tail);

    bird.scale.setScalar(baseScale);

    return {
      bird,
      leftPivot,
      rightPivot,
      phase,
      flapSpeed,
      baseScale
    };
  }

  start({ scene, camera, getGroundHeight }) {
    if (this.started) return;

    this.started = true;
    this.scene = scene;

    this.group = new THREE.Group();
    this.group.name = 'BirdStrikeEvent';

    // Work out the direction the train is travelling.
    const forward = new THREE.Vector3();

    camera.getWorldDirection(forward);
    forward.y = 0;

    if (forward.lengthSq() < 1e-6) {
      forward.set(0, 0, -1);
    }

    forward.normalize();

    // Horizontal vector pointing to the chosen side of the train.
    const right = new THREE.Vector3(
      -forward.z,
      0,
      forward.x
    ).normalize().multiplyScalar(this.side);

    // Starting point beside and ahead of the cab.
    const origin = camera.position.clone()
      .addScaledVector(forward, 24)
      .addScaledVector(right, 10);

    const groundY = typeof getGroundHeight === 'function'
      ? getGroundHeight(origin.x, origin.z)
      : camera.position.y - 4;

    origin.y = Math.max(
      groundY + 1.6,
      camera.position.y - 0.8
    );

    for (let i = 0; i < this.count; i++) {

      // Individual animation characteristics.
      const phase = Math.random() * Math.PI * 2;
      const flapSpeed = 11 + Math.random() * 8;
      const baseScale = 0.65 + Math.random() * 0.5;

      const item = this.makeBird(
        phase,
        flapSpeed,
        baseScale
      );

      // Random starting positions around the flock.
      const spreadRight =
        (Math.random() - 0.5) * this.spread * 2;

      const spreadForward =
        (Math.random() - 0.5) * this.spread * 1.2;

      const spreadY =
        (Math.random() - 0.5) * 2.5;

      item.bird.position.copy(origin)
        .addScaledVector(right, spreadRight)
        .addScaledVector(forward, spreadForward);

      item.bird.position.y += spreadY;

      // Individual escape direction and speed.
      const outwardSpeed = (Math.random() - 0.15) * 9;
      const forwardSpeed = 1 + Math.random() * 9;
      const climbSpeed = 1.5 + Math.random() * 5;

      item.velocity = right.clone()
        .multiplyScalar(outwardSpeed)
        .addScaledVector(forward, forwardSpeed);

      item.velocity.y = climbSpeed;

      // Independent steering and flight characteristics.
      item.turnRate = (Math.random() - 0.5) * 1.8;

      item.driftX = (Math.random() - 0.5) * 3;
      item.driftZ = (Math.random() - 0.5) * 3;

      item.liftAmp = 0.3 + Math.random() * 1.2;
      item.liftFreq = 2 + Math.random() * 4;

      item.bank = (Math.random() - 0.5) * 0.8;

      // Face direction of travel.
      const lookTarget = item.bird.position.clone()
        .sub(item.velocity);

      item.bird.lookAt(lookTarget);

      this.group.add(item.bird);
      this.birds.push(item);
    }

    scene.add(this.group);
  }

  update(dt) {
    if (!this.started || this.finished) return false;

    const stepDt = Math.min(dt, 0.05);

    this.elapsed += stepDt;

    const t = Math.min(
      this.elapsed / this.duration,
      1
    );

    const fade = t > 0.72
      ? 1 - (t - 0.72) / 0.28
      : 1;

    const upAxis = new THREE.Vector3(0, 1, 0);
    const lookTarget = new THREE.Vector3();

    for (const item of this.birds) {

      // Each bird turns independently.
      item.velocity.applyAxisAngle(
        upAxis,
        item.turnRate * stepDt
      );

      // Individual drifting and steering.
      item.velocity.x += item.driftX * stepDt;
      item.velocity.z += item.driftZ * stepDt;

      // Limit horizontal speed.
      const horizontalSpeed = Math.sqrt(
        item.velocity.x * item.velocity.x +
        item.velocity.z * item.velocity.z
      );

      if (horizontalSpeed > 13) {
        item.velocity.x *= 13 / horizontalSpeed;
        item.velocity.z *= 13 / horizontalSpeed;
      }

      // Individual climbing behaviour.
      item.velocity.y +=
        Math.sin(
          this.elapsed * item.liftFreq + item.phase
        ) * item.liftAmp * stepDt;

      item.velocity.y = THREE.MathUtils.clamp(
        item.velocity.y,
        0.5,
        8
      );

      // Move bird.
      item.bird.position.addScaledVector(
        item.velocity,
        stepDt
      );

      // Face direction of travel.
      lookTarget.copy(item.bird.position)
        .sub(item.velocity);

      item.bird.lookAt(lookTarget);

      // Independent wing-flapping animation.
      const cycle =
        this.elapsed * item.flapSpeed + item.phase;

      const flapAngle =
        Math.sin(cycle) * 0.75 +
        Math.sin(cycle * 2) * 0.12;

      // Opposite rotation signs lift both wing tips.
      item.leftPivot.rotation.z = -flapAngle;
      item.rightPivot.rotation.z = flapAngle;

      // Slight variation between the two wings.
      item.leftPivot.rotation.x =
        Math.sin(cycle * 0.5) * 0.12;

      item.rightPivot.rotation.x =
        Math.sin(cycle * 0.5 + 0.4) * 0.12;

      // Individual banking.
      item.bird.rotation.z +=
        (item.bank - item.bird.rotation.z)
        * stepDt * 0.5;

      // Fade out towards the end.
      item.bird.scale.setScalar(
        Math.max(0.001, item.baseScale * fade)
      );
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
