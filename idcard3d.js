// 3D renderer for the hero ID card.
// The physics, dragging and flipping all live in the 2D card script in index.html.
// This file only draws that same card in WebGL: a glossy twisted ribbon, a plastic clip,
// a laminated card with thickness, a soft colour aura and a real shadow on the page.
// If WebGL or the module fails to load, the 2D card simply stays visible.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const api = window.__idc2d;
if (api) start().catch(err => console.warn('3D ID card unavailable, using 2D card', err));

async function start(){
  const { wrap, hero } = api;
  const test = document.createElement('canvas');
  if (!(test.getContext('webgl2') || test.getContext('webgl'))) return;

  // fonts + photo must be ready before the card faces are painted
  await Promise.all([
    document.fonts.load('900 80px "Playfair Display"'),
    document.fonts.load('italic 400 80px "Playfair Display"'),
    document.fonts.load('500 40px "DM Sans"'),
    document.fonts.load('300 40px "DM Sans"'),
    document.fonts.load('400 30px "DM Mono"'),
  ]).catch(() => {});
  const photo = await loadImage('sufia-id.webp').catch(() => null);

  const OLIVE = '#7A8C52', OLIVE_D = '#5d6b3c', CREAM = '#F0EAD6', CARD = '#F8F4EA', INK = '#1A1714';
  const BW = 236, BH = 344, THICK = 3.2;               // card size in base px (scaled by k)

  // ── renderer / scene ──
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.className = 'idc-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  hero.insertBefore(canvas, wrap);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(20, 1, 10, 20000);
  scene.add(new THREE.AmbientLight(0xfff6e8, 0.25));
  const key = new THREE.DirectionalLight(0xfff3e0, 1.25);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.radius = 14;
  key.shadow.blurSamples = 20;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0xdfe8ff, 0.6);
  scene.add(rim);

  // the page itself, only catching the shadow
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.17 }));
  wall.receiveShadow = true;
  wall.position.z = -70;
  scene.add(wall);

  // ── aura ──
  const aura = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
    map: auraTexture(), transparent: true, depthWrite: false, opacity: 0.3,
  }));
  aura.position.z = -60;
  scene.add(aura);

  // ── card ──
  const card = new THREE.Group();            // origin = top centre of the card (the swing pivot)
  const body = new THREE.Group();            // yaw / pitch / flip happen here
  card.add(body);
  scene.add(card);

  const shape = roundedRect(-BW / 2, -BH, BW, BH, 13);
  const slot = roundedRect(-18.5, -16.5, 37, 7, 3.5);
  shape.holes.push(slot);
  const edgeGeo = new THREE.ExtrudeGeometry(shape, { depth: THICK, bevelEnabled: false, curveSegments: 10 });
  edgeGeo.translate(0, 0, -THICK / 2);
  const edgeMat = new THREE.MeshPhysicalMaterial({ color: 0xe9e2d0, roughness: 0.55 });
  // caps are hidden (the printed faces sit there) so they can't z-fight with the faces
  const edge = new THREE.Mesh(edgeGeo, [new THREE.MeshBasicMaterial({ visible: false }), edgeMat]);
  edge.castShadow = true;
  body.add(edge);

  const faceGeo = new THREE.ShapeGeometry(shape, 10);
  const uv = faceGeo.attributes.uv, pos = faceGeo.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + BW / 2) / BW, (pos.getY(i) + BH) / BH);
  const laminate = { roughness: 0.5, clearcoat: 0.8, clearcoatRoughness: 0.18, envMapIntensity: 0.55 };
  const front = new THREE.Mesh(faceGeo, new THREE.MeshPhysicalMaterial({ map: faceTexture('front'), ...laminate }));
  front.position.z = THICK / 2 + 0.02;
  const back = new THREE.Mesh(faceGeo, new THREE.MeshPhysicalMaterial({ map: faceTexture('back'), ...laminate }));
  back.rotation.y = Math.PI;
  back.position.z = -THICK / 2 - 0.02;
  front.castShadow = back.castShadow = true;
  body.add(front, back);

  // plastic clip + metal ring through the slot
  const clip = new THREE.Group();
  const clipBody = new THREE.Mesh(
    new THREE.BoxGeometry(40, 16, 8, 1, 1, 1),
    new THREE.MeshPhysicalMaterial({ color: OLIVE_D, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.15 })
  );
  clipBody.position.y = 19;
  clipBody.castShadow = true;
  const tooth = new THREE.Mesh(new THREE.BoxGeometry(14, 10, 5), clipBody.material);
  tooth.position.y = 8;
  const metal = new THREE.MeshStandardMaterial({ color: 0xd8d3c8, metalness: 1, roughness: 0.22 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(7, 1.5, 12, 32), metal);
  ring.rotation.y = Math.PI / 2;
  ring.position.y = -4;
  ring.castShadow = true;
  clip.add(clipBody, tooth, ring);
  card.add(clip);

  // ── ribbons (two strands, a lanyard worn round the neck, seen hanging) ──
  const ribbonTex = ribbonTexture();
  const ribbonMat = new THREE.MeshPhysicalMaterial({
    map: ribbonTex, side: THREE.DoubleSide, roughness: 0.34, clearcoat: 0.55, clearcoatRoughness: 0.25,
    sheen: 1, sheenColor: new THREE.Color('#e7f0c8'), sheenRoughness: 0.35, envMapIntensity: 0.8,
  });
  const SEG = 72;
  const strands = [0, 1].map(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEG + 1) * 2 * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((SEG + 1) * 2 * 2), 2));
    const idx = [];
    for (let i = 0; i < SEG; i++){ const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    const m = new THREE.Mesh(g, ribbonMat);
    m.castShadow = true;
    m.frustumCulled = false;
    scene.add(m);
    return m;
  });

  // ── sizing ──
  let cw = 0, ch = 0;
  function resize(){
    cw = hero.clientWidth; ch = innerHeight;
    renderer.setSize(cw, ch, false);
    canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
    camera.aspect = cw / ch;
    camera.position.set(0, 0, (ch / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    camera.near = camera.position.z * 0.2; camera.far = camera.position.z * 3;
    camera.updateProjectionMatrix();
    wall.scale.set(cw * 1.6, ch * 1.6, 1);
    const sc = key.shadow.camera;
    sc.left = -cw; sc.right = cw; sc.top = ch; sc.bottom = -ch; sc.near = 10; sc.far = 6000;
    sc.updateProjectionMatrix();
  }
  resize();
  addEventListener('resize', resize);

  // hero px (x right, y down) → world (y up, centred)
  const W = (x, y, z = 0) => new THREE.Vector3(x - cw / 2, ch / 2 - y, z);

  // ── animation ──
  let yaw = 0, yawV = 0, last = performance.now(), visible = true;
  new IntersectionObserver(es => { visible = es[0].isIntersecting; }, { threshold: 0 }).observe(hero);
  wrap.classList.add('is-3d');

  const tmp = new THREE.Vector3(), up = new THREE.Vector3(), q = new THREE.Quaternion();
  function frame(now){
    requestAnimationFrame(frame);
    const dt = Math.min(0.033, (now - last) / 1000); last = now;
    if (!visible) return;
    const s = api.get();
    const k = s.k;

    // card transform from the 2D physics
    const pivot = W(s.left + s.px, s.top + s.py + s.clipH);
    card.position.copy(pivot);
    card.scale.setScalar(k);
    const swing = s.theta + s.phi;
    const target = (s.flipped ? Math.PI : 0) + Math.max(-0.6, Math.min(0.6, s.omega * 0.22));
    yawV += ((target - yaw) * 90 - yawV * 11) * dt;
    yaw += yawV * dt;
    const pitch = Math.max(-0.25, Math.min(0.25, -s.lenV * 0.0009 + Math.abs(s.omega) * 0.04));
    card.rotation.set(0, 0, swing);
    body.rotation.set(pitch, yaw, 0);
    clip.rotation.set(pitch * 0.6, yaw * 0.35, 0);
    card.updateMatrixWorld(true);

    // light follows the card a little so the shadow lands down and to the right of it
    wall.position.z = -70 * k;   // the gap to the page, and so the shadow offset, scales with the card
    key.position.set(pivot.x - 520, pivot.y + 900, 1500);
    key.target.position.set(pivot.x, pivot.y - 200, 0);
    rim.position.set(pivot.x + 800, pivot.y - 200, 600);

    // aura behind the card's centre
    tmp.set(0, -BH / 2, 0); card.localToWorld(tmp);
    aura.position.set(tmp.x, tmp.y, -60);
    const e = Math.min(2, s.energy);
    const as = BW * k * (2.1 + e * 0.25);
    aura.scale.set(as, as * 1.15, 1);
    aura.rotation.z += dt * 0.6;
    aura.material.opacity = 0.22 + Math.min(0.6, e * 0.5);

    // ribbons: from above the page down into the clip
    const clipTop = new THREE.Vector3(0, 26, 0); clip.localToWorld(clipTop);
    up.set(0, 1, 0).applyQuaternion(card.getWorldQuaternion(q)).normalize();
    const ax = s.left + s.W / 2;
    const spread = s.pinned ? 0 : 34 * Math.max(k, 0.7);
    const topY = s.pinned ? s.top + s.AY : s.top + s.AY - 320;
    const bow = Math.max(-46, Math.min(46, -s.omega * 26));
    const ribbonW = 30 * Math.max(k, 0.72);
    for (let i = 0; i < 2; i++){
      const side = i ? 1 : -1;
      const p0 = W(ax + side * spread, topY, side * 14);
      const p3 = clipTop.clone().add(new THREE.Vector3(side * 9 * k, 0, side * 2));
      const len = p0.distanceTo(p3);
      const p1 = p0.clone().add(new THREE.Vector3(bow * 0.4, -len * 0.35, side * 10));
      const p2 = p3.clone().add(up.clone().multiplyScalar(len * 0.32)).add(new THREE.Vector3(bow + side * 10, 0, side * 6));
      buildRibbon(strands[i], p0, p1, p2, p3, ribbonW, side, yaw, swing, len, now);
    }

    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);

  // ── helpers ──
  function buildRibbon(mesh, p0, p1, p2, p3, width, side, yaw, swing, length, now){
    const P = mesh.geometry.attributes.position, U = mesh.geometry.attributes.uv;
    const curve = new THREE.CubicBezierCurve3(p0, p1, p2, p3);
    const pts = curve.getSpacedPoints(SEG);
    const face = new THREE.Vector3(0, 0, 1), T = new THREE.Vector3(), B = new THREE.Vector3();
    const texLen = 260; // world px per texture repeat
    for (let j = 0; j <= SEG; j++){
      const t = j / SEG;
      const a = pts[Math.max(0, j - 1)], b = pts[Math.min(SEG, j + 1)];
      T.subVectors(b, a).normalize();
      B.crossVectors(T, face).normalize();
      // a lazy half twist along each strand, plus the card's turn carried up the ribbon
      const tw = side * 1.7 * Math.sin(Math.PI * t) * (0.75 + 0.25 * Math.sin(now / 1400 + side))
               + (yaw % (Math.PI * 2)) * t * t * 0.5;
      B.applyAxisAngle(T, tw);
      const c = pts[j];
      P.setXYZ(j * 2,     c.x - B.x * width / 2, c.y - B.y * width / 2, c.z - B.z * width / 2);
      P.setXYZ(j * 2 + 1, c.x + B.x * width / 2, c.y + B.y * width / 2, c.z + B.z * width / 2);
      const u = (1 - t) * length / texLen;
      U.setXY(j * 2, u, 0); U.setXY(j * 2 + 1, u, 1);
    }
    P.needsUpdate = true; U.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }

  function roundedRect(x, y, w, h, r){
    const s = new THREE.Shape();
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }

  function loadImage(src){
    return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  }

  function makeTex(c){
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  }

  function spaced(ctx, text, x, y, spacing, align = 'left'){
    if ('letterSpacing' in ctx){
      ctx.letterSpacing = spacing + 'px';
      ctx.textAlign = align;
      ctx.fillText(text, x, y);
      ctx.letterSpacing = '0px';
      return;
    }
    // fallback: draw letter by letter
    let wsum = 0; for (const ch of text) wsum += ctx.measureText(ch).width + spacing;
    let cx = align === 'right' ? x - wsum : x;
    ctx.textAlign = 'left';
    for (const ch of text){ ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + spacing; }
  }

  function barcode(ctx, x, y, w, h){
    const pat = [1,2,1,1,2,1,3,1,1,2,1,1,2,2,1,1,3,1,2,1,1,2,1,3];
    let cx = x, i = 0;
    while (cx < x + w){ const bw = pat[i % pat.length]; if (i % 2 === 0) ctx.fillRect(cx, y, bw, h); cx += bw + 1; i++; }
  }

  function faceTexture(which){
    const S = 4, c = document.createElement('canvas');
    c.width = BW * S; c.height = BH * S;
    const x = c.getContext('2d');
    x.scale(S, S);
    const pad = 17.5;
    if (which === 'front'){
      x.fillStyle = CARD; x.fillRect(0, 0, BW, BH);
      // meta row
      x.fillStyle = OLIVE; x.beginPath(); x.arc(pad + 2.6, 30.4, 2.6, 0, Math.PI * 2); x.fill();
      x.fillStyle = 'rgba(26,23,20,.55)'; x.font = '400 7.2px "DM Mono"';
      spaced(x, 'PORTFOLIO', pad + 9, 33, 1.5);
      spaced(x, 'NO. 001', BW - pad, 33, 1.5, 'right');
      // photo box with halftone dots
      const px = pad, py = 42, pw = BW - pad * 2, ph = 206;
      x.save(); rr(x, px, py, pw, ph, 7); x.clip();
      x.fillStyle = '#E6DECB'; x.fillRect(px, py, pw, ph);
      x.fillStyle = 'rgba(26,23,20,.15)';
      for (let yy = py + 3; yy < py + ph; yy += 6.4) for (let xx = px + 3; xx < px + pw; xx += 6.4){ x.beginPath(); x.arc(xx, yy, .95, 0, Math.PI * 2); x.fill(); }
      if (photo){
        const ir = photo.width / photo.height, br = pw / ph;
        let dw, dh; if (ir > br){ dh = ph; dw = ph * ir; } else { dw = pw; dh = pw / ir; }
        x.drawImage(photo, px + (pw - dw) / 2, py + (ph - dh) * 0.15, dw, dh);
      }
      x.restore();
      // name + role
      x.fillStyle = INK; x.font = '900 33px "Playfair Display"'; x.textAlign = 'left';
      x.fillText('Sufia', pad, 286);
      const nw = x.measureText('Sufia').width;
      x.fillStyle = OLIVE; x.font = 'italic 400 33px "Playfair Display"'; x.fillText('.', pad + nw + 1, 286);
      x.fillStyle = '#3d3833'; x.font = '500 12.4px "DM Sans"'; x.fillText('Product Manager', pad, 304);
      // footer
      x.fillStyle = 'rgba(26,23,20,.1)'; x.fillRect(pad, 315, BW - pad * 2, 1);
      x.fillStyle = 'rgba(26,23,20,.6)'; x.font = '400 7px "DM Mono"';
      spaced(x, 'HYDERABAD · IN', pad, 333, 1.3);
      barcode(x, BW - pad - 64, 322, 64, 13);
    } else {
      x.fillStyle = OLIVE; x.fillRect(0, 0, BW, BH);
      // woven texture like the folders
      x.fillStyle = 'rgba(255,255,255,.035)'; for (let i = 0; i < BW; i += 3) x.fillRect(i, 0, 1, BH);
      x.fillStyle = 'rgba(0,0,0,.035)'; for (let i = 0; i < BH; i += 3) x.fillRect(0, i, BW, 1);
      x.fillStyle = CREAM; x.beginPath(); x.arc(pad + 2.6, 30.4, 2.6, 0, Math.PI * 2); x.fill();
      x.fillStyle = 'rgba(240,234,214,.65)'; x.font = '400 7.2px "DM Mono"';
      spaced(x, 'SUFIA', pad + 9, 33, 1.5);
      spaced(x, 'NO. 001', BW - pad, 33, 1.5, 'right');
      // halftone glow
      for (let yy = 50; yy < 150; yy += 8) for (let xx = pad; xx < BW - pad; xx += 8){
        const dx = (xx - BW / 2) / (BW * 0.42), dy = (yy - 96) / 52, d = Math.sqrt(dx * dx + dy * dy);
        if (d > 1) continue;
        x.fillStyle = `rgba(240,234,214,${0.65 * (1 - d)})`;
        x.beginPath(); x.arc(xx, yy, 1.5, 0, Math.PI * 2); x.fill();
      }
      x.fillStyle = CREAM; x.font = '900 35px "Playfair Display"'; x.textAlign = 'left';
      x.fillText('Product,', pad, 232);
      x.fillText('Tech', pad, 266);
      const tw = x.measureText('Tech ').width;
      x.font = 'italic 400 35px "Playfair Display"'; x.fillText('&', pad + tw, 266);
      const aw = x.measureText('& ').width;
      x.font = '900 35px "Playfair Display"'; x.fillText('AI', pad + tw + aw, 266);
      x.fillStyle = 'rgba(240,234,214,.85)'; x.font = '300 11px "DM Sans"';
      x.fillText('Building things from nothing.', pad, 287);
      x.fillText('Open to product & tech roles.', pad, 302);
      x.fillStyle = 'rgba(240,234,214,.22)'; x.fillRect(pad, 315, BW - pad * 2, 1);
      x.fillStyle = 'rgba(240,234,214,.65)'; x.font = '400 7px "DM Mono"';
      spaced(x, 'ACCESS · ALL AREAS', pad, 333, 1.3);
      barcode(x, BW - pad - 64, 322, 64, 13);
    }
    return makeTex(c);
  }

  function rr(x, X, Y, w, h, r){
    x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r);
    x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath();
  }

  function ribbonTexture(){
    const c = document.createElement('canvas'); c.width = 1040; c.height = 80;
    const x = c.getContext('2d');
    x.fillStyle = OLIVE; x.fillRect(0, 0, c.width, c.height);
    // weave
    x.fillStyle = 'rgba(0,0,0,.07)'; for (let i = 0; i < c.width; i += 4) x.fillRect(i, 0, 1.5, c.height);
    x.fillStyle = 'rgba(255,255,255,.05)'; for (let i = 0; i < c.height; i += 4) x.fillRect(0, i, c.width, 1.5);
    // darker selvedge + stitching
    x.fillStyle = OLIVE_D; x.fillRect(0, 0, c.width, 5); x.fillRect(0, c.height - 5, c.width, 5);
    x.fillStyle = 'rgba(240,234,214,.6)';
    for (let i = 0; i < c.width; i += 14){ x.fillRect(i, 9, 8, 2); x.fillRect(i, c.height - 11, 8, 2); }
    // text
    x.fillStyle = CREAM; x.font = '400 26px "DM Mono"'; x.textBaseline = 'middle';
    const words = ['SUFIA', '✦', 'PORTFOLIO', '✦'];
    let cx = 20, i = 0;
    while (cx < c.width - 20){ const w = words[i % 4]; spaced(x, w, cx, c.height / 2 + 1, 6); cx += x.measureText(w).width + w.length * 6 + 26; i++; }
    const t = makeTex(c);
    t.wrapS = THREE.RepeatWrapping;
    return t;
  }

  function auraTexture(){
    // one soft olive glow
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, 'rgba(122,140,82,.55)');
    g.addColorStop(0.45, 'rgba(122,140,82,.28)');
    g.addColorStop(1, 'rgba(122,140,82,0)');
    x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    return makeTex(c);
  }

}
