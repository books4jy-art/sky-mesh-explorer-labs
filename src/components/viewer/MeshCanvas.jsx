import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

/**
 * Reusable 3D mesh canvas.
 *
 * Props:
 *   meshes            optional array of { positions, uvs, indices } to render
 *                     together (a base mesh + additional parts). When omitted,
 *                     the single-mesh props below are used instead.
 *   positions, uvs, indices  single-mesh geometry (used when `meshes` is not
 *                     supplied) — byte-for-byte identical to the previous
 *                     single-mesh behavior.
 *   wireframe, autoRotate, texture  display controls, applied to every mesh.
 *
 * The single-mesh path is unchanged; passing `meshes` renders a base mesh plus
 * additional parts in the same scene (each centered to the shared origin, grid and
 * orbit sized to the largest mesh).
 */
export default function MeshCanvas({ meshes, positions, uvs, indices, wireframe, autoRotate, texture }) {
  const mountRef = useRef(null);
  const textureRef = useRef(null);
  const stateRef = useRef({});

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0b0d12');

    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 5000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight('#cfe6ff', '#20242e', 1.1));
    const key = new THREE.DirectionalLight('#ffffff', 1.5);
    key.position.set(3, 5, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight('#7dd3fc', 0.6);
    rim.position.set(-4, -1, -3);
    scene.add(rim);

    // Normalize to a list of meshes. When `meshes` is not supplied, fall back to
    // the single-mesh props — identical to the previous single-mesh behavior.
    const list = (meshes && meshes.length) ? meshes : [{ positions, uvs, indices }];
    // Multi-mesh path (meshes supplied): keep each piece's original world coordinates
    // and center the WHOLE assembled group once via a shared translation, preserving
    // relative offsets between pieces. Single-mesh path (fallback) centers the one
    // mesh to the origin exactly as before — byte-for-byte identical.
    const isMulti = !!(meshes && meshes.length);
    const combinedBox = isMulti ? new THREE.Box3() : null;

    const pivot = new THREE.Group();
    scene.add(pivot);

    const materials = [];
    const geometries = [];
    let maxRadius = 0;
    for (const m of list) {
      if (!m || !m.positions || !m.indices) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
      if (m.uvs) geo.setAttribute('uv', new THREE.BufferAttribute(m.uvs, 2));
      geo.setIndex(new THREE.BufferAttribute(m.indices, 1));
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      if (isMulti) geo.computeBoundingBox();

      const material = new THREE.MeshStandardMaterial({
        color: '#dbe7f5', metalness: 0.1, roughness: 0.55, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, material);
      if (!isMulti) {
        const center = geo.boundingSphere.center.clone();
        mesh.position.sub(center);
      }
      pivot.add(mesh);

      materials.push(material);
      geometries.push(geo);
      if (!isMulti) {
        const r = geo.boundingSphere.radius || 1;
        if (r > maxRadius) maxRadius = r;
      } else {
        combinedBox.union(geo.boundingBox);
      }
    }
    let radius;
    if (isMulti) {
      if (combinedBox.isEmpty()) {
        radius = 1;
      } else {
        const combinedCenter = combinedBox.getCenter(new THREE.Vector3());
        pivot.position.copy(combinedCenter).multiplyScalar(-1);
        radius = (combinedBox.getSize(new THREE.Vector3()).length() / 2) || 1;
      }
    } else {
      radius = maxRadius || 1;
    }

    const grid = new THREE.GridHelper(radius * 6, 24, '#243044', '#161c26');
    grid.position.y = -radius * 1.1;
    scene.add(grid);

    // --- simple orbit controls ---
    const orbit = { theta: Math.PI * 0.25, phi: Math.PI * 0.42, dist: radius * 3.2 };
    let dragging = false, lastX = 0, lastY = 0;

    const onDown = (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; };
    const onUp = () => { dragging = false; };
    const onMove = (e) => {
      if (!dragging) return;
      orbit.theta -= (e.clientX - lastX) * 0.007;
      orbit.phi -= (e.clientY - lastY) * 0.007;
      orbit.phi = Math.max(0.05, Math.min(Math.PI - 0.05, orbit.phi));
      lastX = e.clientX; lastY = e.clientY;
    };
    const onWheel = (e) => {
      e.preventDefault();
      orbit.dist *= e.deltaY > 0 ? 1.1 : 0.9;
      orbit.dist = Math.max(radius * 0.4, Math.min(radius * 30, orbit.dist));
    };
    const el = renderer.domElement;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointermove', onMove);
    el.addEventListener('wheel', onWheel, { passive: false });

    const resize = () => {
      const w = mount.clientWidth, hh = mount.clientHeight;
      renderer.setSize(w, hh);
      camera.aspect = w / Math.max(hh, 1);
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    let raf;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      if (stateRef.current.autoRotate && !dragging) orbit.theta += 0.0035;
      camera.position.set(
        orbit.dist * Math.sin(orbit.phi) * Math.sin(orbit.theta),
        orbit.dist * Math.cos(orbit.phi),
        orbit.dist * Math.sin(orbit.phi) * Math.cos(orbit.theta)
      );
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
    };
    animate();

    if (textureRef.current) {
      for (const mat of materials) { mat.map = textureRef.current; mat.color.set(0xffffff); mat.needsUpdate = true; }
    }
    stateRef.current.materials = materials;

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointermove', onMove);
      el.removeEventListener('wheel', onWheel);
      for (const g of geometries) g.dispose();
      for (const mat of materials) mat.dispose();
      renderer.dispose();
      if (el.parentNode === mount) mount.removeChild(el);
    };
  }, [meshes, positions, uvs, indices]);

  useEffect(() => {
    stateRef.current.autoRotate = autoRotate;
    const mats = stateRef.current.materials || [];
    for (const mat of mats) mat.wireframe = wireframe;
  }, [autoRotate, wireframe]);

  useEffect(() => {
    textureRef.current = texture;
    const mats = stateRef.current.materials || [];
    if (!mats.length) return;
    for (const mat of mats) {
      mat.map = texture || null;
      mat.color.set(texture ? 0xffffff : '#dbe7f5');
      mat.needsUpdate = true;
    }
  }, [texture]);

  return <div ref={mountRef} className="h-full w-full" />;
}
