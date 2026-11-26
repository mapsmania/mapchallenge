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

    this.bodyGeometry = new THREE.SphereGeometry(1, 7, 5);
    this.wingGeometry = this.createWingGeometry();
    this.bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0x292d2b,
      roughness: 1,
      side: THREE.DoubleSide
    });
    this.wingMaterial = new THREE.MeshStandardMaterial({
      color: 0x202523,
      roughness: 1,
      side: THREE.DoubleSide
    });
  }

  createWingGeometry() {
    // A simple tapered wing silhouette. The second wing uses a mirrored copy.
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0,
      -0.78, 0.08, 0,
      -0.57, -0.16, 0,
      -0.36, -0.10, 0,
      -0.18, -0.20, 0
    ], 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3, 0, 3, 4]);
    geometry.computeVertexNormals();
    return geometry;
  }

  makeBird(phase, scale) {
    const bird = new THREE.Group();

    const body = new THREE.Mesh(this.bodyGeometry, this.bodyMaterial);
    body.scale.set(0.13 * scale, 0.34 * scale, 0.12 * scale);
    bird.add(body);

    const leftPivot = new THREE.Group();
    leftPivot.position.set(-0.075 * scale, 0.04 * scale, 0);

    const leftWing = new THREE.Mesh(this.wingGeometry, this.wingMaterial);
    leftWing.scale.set(scale, scale, scale);
    leftPivot.add(leftWing);
    bird.add(leftPivot);

    const rightPivot = new THREE.Group();
    rightPivot.position.set(0.075 * scale, 0.04 * scale, 0);

    const rightWing = new THREE.Mesh(this.wingGeometry, this.wingMaterial);
    rightWing.scale.set(-scale, scale, scale);
    rightPivot.add(rightWing);
    bird.add(rightPivot);

    // A small tail helps the silhouette read as a bird from the cab.
    const tail = new THREE.Mesh(
      new THREE.ConeGeometry(0.09 * scale, 0.22 * scale, 4),
      this.wingMaterial
    );
    tail.rotation.x = Math.PI / 2;
    tail.position.y = -0.27 * scale;
    bird.add(tail);

    bird.traverse(object => {
      if (object.isMesh) {
        object.castShadow = false;
        object.receiveShadow = false;
      }
    });

    return { bird, leftPivot, rightPivot, phase };
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
    forward.normalize();

    // Horizontal vector pointing to the chosen side of the train.
    const right = new THREE.Vector3(forward.z, 0, -forward.x)
      .normalize()
      .multiplyScalar(this.side);

    // Birds burst out from just ahead of the cab and beside the track.
    const origin = camera.position.clone()
      .addScaledVector(forward, 22)
      .addScaledVector(right, 9);

    const groundY = getGroundHeight(origin.x, origin.z);
    origin.y = Math.max(groundY + 1.4, camera.position.y - 1.0);

    for (let i = 0; i < this.count; i++) {
      const phase = i * 1.73;

      const spreadX =
        (Math.sin(i * 12.37) * 0.5 +
         Math.cos(i * 3.1) * 0.5) * this.spread;

      const spreadZ =
        (Math.cos(i * 8.17) * 0.5 +
         Math.sin(i * 5.4) * 0.5) * this.spread * 0.55;

      const scale = 0.72 + ((i * 7) % 6) * 0.09;
      const item = this.makeBird(phase, scale);

      item.bird.position.copy(origin)
        .addScaledVector(right, spreadX)
        .addScaledVector(forward, spreadZ);

      // Each bird fans out in a slightly different direction and climbs.
      const outward = 1.8 + (i % 5) * 0.55;

      item.velocity = right.clone().multiplyScalar(outward)
        .addScaledVector(forward, 3.0 + (i % 4) * 0.8);

      item.velocity.y = 2.0 + (i % 6) * 0.42;

      item.bird.rotation.y = Math.atan2(-forward.x, -forward.z);
      item.leftPivot.rotation.x = 0.2;
      item.rightPivot.rotation.x = -0.2;

      this.group.add(item.bird);
      this.birds.push(item);
    }

    scene.add(this.group);
  }

  update(dt) {
    if (!this.started || this.finished) return false;

    this.elapsed += dt;

    const t = Math.min(this.elapsed / this.duration, 1);
    const fade = t > 0.72 ? 1 - (t - 0.72) / 0.28 : 1;

    for (const item of this.birds) {
      item.bird.position.addScaledVector(item.velocity, dt);

      // A little lift and drift makes the flock scatter rather than move as a block.
      item.bird.position.y +=
        Math.sin(this.elapsed * 2.2 + item.phase) * dt * 0.45;

      const flap = Math.sin(this.elapsed * 15 + item.phase) * 0.85;

      item.leftPivot.rotation.x = flap;
      item.rightPivot.rotation.x = -flap;

      item.bird.scale.setScalar(Math.max(0.001, fade));
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
    this.bodyMaterial.dispose();
    this.wingMaterial.dispose();
  }
}
