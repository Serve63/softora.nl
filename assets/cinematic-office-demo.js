(function () {
  const canvas = document.getElementById("officeCanvas");
  const stage = document.getElementById("cinematicStage");
  const progressBar = document.getElementById("sceneProgress");
  const percentLabel = document.getElementById("scenePercent");
  const statusLabel = document.getElementById("sceneStatus");
  const panels = Array.from(document.querySelectorAll("[data-story-panel]"));

  if (!canvas || !stage || !window.THREE) {
    return;
  }

  const THREE = window.THREE;
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x080706);
  scene.fog = new THREE.FogExp2(0x080706, 0.045);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 90);
  const clock = new THREE.Clock();
  const animationMixers = [];
  let scrollProgress = 0;
  let smoothProgress = 0;
  let frameCount = 0;

  const materials = {
    floor: new THREE.MeshStandardMaterial({ color: 0x2a1710, roughness: 0.68, metalness: 0.05 }),
    wall: new THREE.MeshStandardMaterial({ color: 0x28221e, roughness: 0.82, metalness: 0.02 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x2b4652, roughness: 0.18, metalness: 0.12, transparent: true, opacity: 0.34 }),
    table: new THREE.MeshStandardMaterial({ color: 0x4a2818, roughness: 0.52, metalness: 0.08 }),
    black: new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.5, metalness: 0.35 }),
    chair: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.36, metalness: 0.18 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xd7a85c, roughness: 0.34, metalness: 0.42, emissive: 0x33210b, emissiveIntensity: 0.15 }),
    burgundy: new THREE.MeshStandardMaterial({ color: 0x8b2252, roughness: 0.46, metalness: 0.12, emissive: 0x240814, emissiveIntensity: 0.24 }),
    green: new THREE.MeshStandardMaterial({ color: 0x264b38, roughness: 0.7, metalness: 0.02 }),
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function easeInOut(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function addBox(name, size, position, material, castShadow, receiveShadow) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
    mesh.name = name;
    mesh.position.set(position[0], position[1], position[2]);
    mesh.castShadow = Boolean(castShadow);
    mesh.receiveShadow = Boolean(receiveShadow);
    scene.add(mesh);
    return mesh;
  }

  function makeCanvasTexture(draw) {
    const textureCanvas = document.createElement("canvas");
    textureCanvas.width = 1024;
    textureCanvas.height = 512;
    const ctx = textureCanvas.getContext("2d");
    draw(ctx, textureCanvas.width, textureCanvas.height);
    const texture = new THREE.CanvasTexture(textureCanvas);
    texture.encoding = THREE.sRGBEncoding;
    texture.anisotropy = 4;
    return texture;
  }

  function makeScreenTexture(title, accent) {
    return makeCanvasTexture((ctx, width, height) => {
      ctx.fillStyle = "#111417";
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "#f6eee4";
      ctx.font = "700 54px Arial";
      ctx.fillText(title, 64, 82);
      ctx.fillStyle = accent;
      ctx.fillRect(64, 126, 280, 16);
      ctx.fillStyle = "rgba(255,255,255,0.14)";
      for (let index = 0; index < 5; index += 1) {
        ctx.fillRect(64, 180 + index * 48, 360 + index * 64, 14);
      }
      const values = [160, 250, 205, 310, 390, 340, 450];
      values.forEach((value, index) => {
        ctx.fillStyle = index % 2 ? "#68d4c5" : "#8b2252";
        ctx.fillRect(570 + index * 52, 390 - value * 0.55, 28, value * 0.55);
      });
      ctx.strokeStyle = "rgba(215,168,92,0.7)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(560, 320);
      values.forEach((value, index) => ctx.lineTo(574 + index * 52, 330 - value * 0.35));
      ctx.stroke();
    });
  }

  function addScreen(name, position, rotation, title, accent) {
    const screen = addBox(name, [2.65, 1.42, 0.08], position, materials.black, true, false);
    screen.rotation.set(rotation[0], rotation[1], rotation[2]);
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(2.42, 1.18),
      new THREE.MeshBasicMaterial({ map: makeScreenTexture(title, accent), toneMapped: false })
    );
    face.position.set(position[0], position[1] + 0.01, position[2] + 0.046);
    face.rotation.copy(screen.rotation);
    scene.add(face);
    return screen;
  }

  function addPlant(x, z, scale) {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * scale, 0.28 * scale, 0.42 * scale, 20), materials.burgundy);
    pot.position.set(x, 0.22 * scale, z);
    pot.castShadow = true;
    scene.add(pot);

    for (let index = 0; index < 7; index += 1) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.1 * scale, 0.72 * scale, 8), materials.green);
      const angle = (index / 7) * Math.PI * 2;
      leaf.position.set(x + Math.cos(angle) * 0.16 * scale, 0.72 * scale, z + Math.sin(angle) * 0.16 * scale);
      leaf.rotation.set(0.8, angle, 0.24);
      leaf.castShadow = true;
      scene.add(leaf);
    }
  }

  function addChair(x, z, rotationY) {
    const chair = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.16, 0.72), materials.chair);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.8, 0.12), materials.chair);
    seat.position.set(0, 0.46, 0);
    back.position.set(0, 0.86, 0.34);
    seat.castShadow = true;
    back.castShadow = true;
    chair.add(seat);
    chair.add(back);
    chair.position.set(x, 0, z);
    chair.rotation.y = rotationY;
    scene.add(chair);
    return chair;
  }

  function addRoom() {
    addBox("floor", [12, 0.16, 10], [0, -0.08, 0], materials.floor, false, true);
    addBox("back-wall", [12, 4.4, 0.18], [0, 2.2, -4.92], materials.wall, false, true);
    addBox("left-wall", [0.18, 4.4, 10], [-5.92, 2.2, 0], materials.wall, false, true);
    addBox("right-glass", [0.12, 3.4, 8.4], [5.92, 2.05, 0.2], materials.glass, false, false);

    for (let x = -4.5; x <= 4.5; x += 1.5) {
      addBox("floor-line", [0.025, 0.01, 10], [x, 0.01, 0], new THREE.MeshBasicMaterial({ color: 0x3d2b22 }), false, false);
    }

    addBox("meeting-table", [4.4, 0.34, 1.85], [0, 0.72, -0.95], materials.table, true, true);
    addBox("table-leg-a", [0.22, 0.72, 0.22], [-1.78, 0.34, -1.65], materials.black, true, false);
    addBox("table-leg-b", [0.22, 0.72, 0.22], [1.78, 0.34, -1.65], materials.black, true, false);
    addBox("table-leg-c", [0.22, 0.72, 0.22], [-1.78, 0.34, -0.25], materials.black, true, false);
    addBox("table-leg-d", [0.22, 0.72, 0.22], [1.78, 0.34, -0.25], materials.black, true, false);

    addScreen("center-dashboard", [-1.25, 1.55, -1.88], [-0.12, 0.16, 0], "LEADS", "#68d4c5");
    addScreen("right-dashboard", [1.35, 1.48, -1.78], [-0.1, -0.18, 0], "CALLS", "#d7a85c");
    addScreen("wall-dashboard", [0, 2.42, -4.78], [0, 0, 0], "GROWTH", "#8b2252");

    addChair(-1.85, 0.7, Math.PI);
    addChair(0, 0.82, Math.PI);
    addChair(1.85, 0.72, Math.PI);
    addChair(-2.65, -2.15, 0.28);
    addChair(2.65, -2.15, -0.28);

    addPlant(-5.1, -3.7, 1.1);
    addPlant(4.95, -3.5, 0.95);
    addPlant(-5.15, 3.35, 0.9);

    const logoTexture = makeCanvasTexture((ctx, width, height) => {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#f5eadf";
      ctx.font = "700 108px Arial";
      ctx.textAlign = "center";
      ctx.fillText("SOFTORA", width / 2, 260);
      ctx.fillStyle = "#d7a85c";
      ctx.fillRect(346, 300, 332, 8);
    });
    const logo = new THREE.Mesh(
      new THREE.PlaneGeometry(3.1, 1.35),
      new THREE.MeshBasicMaterial({ map: logoTexture, transparent: true, toneMapped: false })
    );
    logo.position.set(3.1, 3.12, -4.81);
    scene.add(logo);
  }

  function addLights() {
    const ambient = new THREE.HemisphereLight(0xfff3df, 0x151515, 0.52);
    scene.add(ambient);

    const key = new THREE.DirectionalLight(0xffe0a8, 1.8);
    key.position.set(-4.2, 7.5, 5.2);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    scene.add(key);

    const burgundy = new THREE.PointLight(0x8b2252, 1.8, 8, 2);
    burgundy.position.set(-4.7, 2.2, -3.6);
    scene.add(burgundy);

    const teal = new THREE.PointLight(0x68d4c5, 1.45, 7, 2);
    teal.position.set(3.8, 2.25, -1.2);
    scene.add(teal);

    [-2.7, 0, 2.7].forEach((x) => {
      const lamp = addBox("ceiling-light", [1.05, 0.07, 0.12], [x, 3.96, -1.2], materials.gold, true, false);
      lamp.userData.baseY = lamp.position.y;
      animationMixers.push(lamp);
      const light = new THREE.PointLight(0xffcf8a, 0.84, 4.4, 2);
      light.position.set(x, 3.62, -1.2);
      scene.add(light);
    });
  }

  function getCameraPath(t) {
    const mobile = window.innerWidth < 760;
    const eased = easeInOut(t);
    const top = mobile ? [0, 15.5, 11] : [-2.8, 16.5, 10.8];
    const mid = mobile ? [0.55, 7.8, 8.9] : [-1.05, 8.2, 8.5];
    const front = mobile ? [0.2, 2.85, 8.6] : [0.15, 2.65, 7.7];
    const lookTop = [0, 0.25, -0.4];
    const lookMid = [0.2, 0.85, -1.2];
    const lookFront = [0.28, 1.65, -2.95];
    const pivot = eased < 0.54 ? eased / 0.54 : (eased - 0.54) / 0.46;
    const from = eased < 0.54 ? top : mid;
    const to = eased < 0.54 ? mid : front;
    const lookFrom = eased < 0.54 ? lookTop : lookMid;
    const lookTo = eased < 0.54 ? lookMid : lookFront;

    return {
      position: [
        lerp(from[0], to[0], pivot),
        lerp(from[1], to[1], pivot),
        lerp(from[2], to[2], pivot),
      ],
      lookAt: [
        lerp(lookFrom[0], lookTo[0], pivot),
        lerp(lookFrom[1], lookTo[1], pivot),
        lerp(lookFrom[2], lookTo[2], pivot),
      ],
      fov: lerp(mobile ? 57 : 48, mobile ? 45 : 39, eased),
    };
  }

  function updateScrollProgress() {
    const rect = stage.getBoundingClientRect();
    const travel = Math.max(1, rect.height - window.innerHeight);
    scrollProgress = clamp(Math.abs(rect.top) / travel, 0, 1);
  }

  function updateCopy(progress) {
    const active = progress < 0.36 ? 0 : progress < 0.73 ? 1 : 2;
    panels.forEach((panel, index) => {
      panel.classList.toggle("is-active", index === active);
    });
    statusLabel.textContent = active === 0 ? "bovenaanzicht" : active === 1 ? "camera drop" : "front view";
    percentLabel.textContent = String(Math.round(progress * 100)).padStart(2, "0");
    progressBar.style.transform = "scaleX(" + progress.toFixed(4) + ")";
  }

  function resize() {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function render() {
    const delta = Math.min(clock.getDelta(), 0.033);
    const target = prefersReducedMotion ? 0.78 : scrollProgress;
    smoothProgress += (target - smoothProgress) * (prefersReducedMotion ? 1 : 0.08);

    paintScene(smoothProgress);
    requestAnimationFrame(render);
    if (!prefersReducedMotion) {
      updateScrollProgress();
    }
    if (delta > 0.032) {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    }
  }

  function paintScene(progress) {
    const cameraState = getCameraPath(progress);
    camera.position.set(cameraState.position[0], cameraState.position[1], cameraState.position[2]);
    camera.fov = cameraState.fov;
    camera.updateProjectionMatrix();
    camera.lookAt(cameraState.lookAt[0], cameraState.lookAt[1], cameraState.lookAt[2]);

    animationMixers.forEach((mesh, index) => {
      mesh.position.y = mesh.userData.baseY + Math.sin(clock.elapsedTime * 1.2 + index) * 0.015;
      mesh.rotation.z = Math.sin(clock.elapsedTime * 0.8 + index) * 0.02;
    });

    updateCopy(smoothProgress);
    renderer.render(scene, camera);
    frameCount += 1;
    if (frameCount % 18 === 0) {
      sampleCanvasPixels();
    }
  }

  function sampleCanvasPixels() {
    const gl = renderer.getContext();
    const points = [
      [0.25, 0.5],
      [0.5, 0.5],
      [0.75, 0.5],
      [0.5, 0.28],
      [0.5, 0.72],
    ];
    const pixel = new Uint8Array(4);
    let bright = 0;

    points.forEach(([xRatio, yRatio]) => {
      const x = Math.floor(gl.drawingBufferWidth * xRatio);
      const y = Math.floor(gl.drawingBufferHeight * yRatio);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      if (pixel[0] + pixel[1] + pixel[2] > 30) {
        bright += 1;
      }
    });

    window.__softoraCinematicStats = {
      brightSamples: bright,
      frameCount,
      height: gl.drawingBufferHeight,
      progress: Number(smoothProgress.toFixed(3)),
      width: gl.drawingBufferWidth,
    };
    document.body.dataset.cinematicBrightSamples = String(bright);
    document.body.dataset.cinematicFrameCount = String(frameCount);
    document.body.dataset.cinematicPixelWidth = String(gl.drawingBufferWidth);
    document.body.dataset.cinematicPixelHeight = String(gl.drawingBufferHeight);
  }

  addRoom();
  addLights();
  resize();
  updateScrollProgress();
  paintScene(0);
  sampleCanvasPixels();
  document.body.dataset.cinematicReady = "true";
  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener("scroll", updateScrollProgress, { passive: true });
  requestAnimationFrame(render);
})();
