// Builds a .glb (binary glTF) from parsed mesh data using Three.js's own
// GLTFExporter — avoids hand-writing a binary file format, and glTF imports
// natively into Blender/Unity/Unreal (unlike ASCII FBX, which Blender rejects
// outright, and unlike binary FBX, which isn't practical to hand-write safely).
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

function invert4(a) {
  const m = Array.from({ length: 4 }, (_, row) => Array.from({ length: 4 }, (_, col) => a[col * 4 + row]));
  const aug = m.map((row, i) => row.concat([0, 0, 0, 0].map((_, j) => (i === j ? 1 : 0))));
  for (let i = 0; i < 4; i += 1) {
    let pivot = i;
    for (let row = i + 1; row < 4; row += 1) if (Math.abs(aug[row][i]) > Math.abs(aug[pivot][i])) pivot = row;
    [aug[i], aug[pivot]] = [aug[pivot], aug[i]];
    const divisor = aug[i][i];
    if (Math.abs(divisor) < 1e-8) return null;
    for (let col = 0; col < 8; col += 1) aug[i][col] /= divisor;
    for (let row = 0; row < 4; row += 1) {
      if (row === i) continue;
      const factor = aug[row][i];
      for (let col = 0; col < 8; col += 1) aug[row][col] -= factor * aug[i][col];
    }
  }
  return aug.map((row) => row.slice(4));
}

function matrixPosition(inv) {
  const matrix = invert4(inv);
  return matrix ? [matrix[0][3], matrix[1][3], matrix[2][3]] : [0, 0, 0];
}

function bboxCenter(flat) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < flat.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], flat[i + axis]);
      max[axis] = Math.max(max[axis], flat[i + axis]);
    }
  }
  return max.map((value, axis) => (value + min[axis]) / 2);
}

// Same heuristic ThatMeshStudio uses: bone head positions come from each
// bone's inverse bind matrix, but whether that puts the skeleton in front of
// or behind the mesh along Z depends on the exporter that produced the .mesh
// file — pick whichever orientation lands the skeleton's bbox center closer
// to the mesh's.
function skeletonWorldPositions(skeleton, vertices) {
  const positions = (skeleton || []).map((bone) => matrixPosition(bone.invBindMatrix));
  if (!positions.length || !vertices?.length) return positions;
  const meshCenter = bboxCenter(vertices), skeletonCenter = bboxCenter(positions.flat());
  return Math.abs(-skeletonCenter[2] - meshCenter[2]) + 0.08 < Math.abs(skeletonCenter[2] - meshCenter[2])
    ? positions.map(([x, y, z]) => [-x, y, -z]) : positions;
}

// Majority vote across every skinned piece's own vertex bbox, rather than
// trusting a single piece — a small/asymmetric accessory (e.g. a hood that
// drapes far to one side) can disagree with the true orientation even
// though the bind matrices behind it are identical to every other piece of
// the same rig (verified against live data: same 124 bones, same names,
// same hierarchy, byte-identical invBindMatrix per bone, file to file).
// Ties (mostly the single-piece case) fall back to the largest piece by
// vertex count, which is the least ambiguous single vote available.
function decideSkeletonFlip(skinnedMeshes, bindPositions) {
  const skeletonCenter = bboxCenter(bindPositions.flat());
  const flipVote = (vertices) => {
    const meshCenter = bboxCenter(vertices);
    return Math.abs(-skeletonCenter[2] - meshCenter[2]) + 0.08 < Math.abs(skeletonCenter[2] - meshCenter[2]);
  };
  let votesFlip = 0, votesNoFlip = 0;
  for (const m of skinnedMeshes) (flipVote(m.positions) ? votesFlip++ : votesNoFlip++);
  if (votesFlip !== votesNoFlip) return votesFlip > votesNoFlip;
  const largest = skinnedMeshes.reduce((a, b) => (b.positions.length > a.positions.length ? b : a));
  return flipVote(largest.positions);
}

function buildSkinAttributes(boneWeights, vertexCount) {
  const skinIndex = new Uint16Array(vertexCount * 4);
  const skinWeight = new Float32Array(vertexCount * 4);
  for (let v = 0; v < vertexCount; v += 1) {
    const weights = (boneWeights[v] || []).slice(0, 4);
    const total = weights.reduce((sum, [, w]) => sum + w, 0) || 1;
    weights.forEach(([boneIndex, weight], slot) => {
      skinIndex[v * 4 + slot] = boneIndex;
      skinWeight[v * 4 + slot] = weight / total;
    });
  }
  return { skinIndex, skinWeight };
}

export async function exportMeshToGlb(parsed, texture) {
  const scene = new THREE.Scene();
  const vertexCount = parsed.vertices.length / 3;
  const hasSkeleton = parsed.skeleton?.length > 0;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(Float32Array.from(parsed.vertices), 3));
  if (parsed.uvs?.length === vertexCount * 2) {
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(Float32Array.from(parsed.uvs), 2));
  }
  geometry.setIndex(Array.from(parsed.indices));
  if (parsed.normals?.length === vertexCount * 3) {
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(Float32Array.from(parsed.normals), 3));
  } else {
    geometry.computeVertexNormals();
  }

  const material = new THREE.MeshStandardMaterial({ color: '#dbe7f5', metalness: 0.1, roughness: 0.55 });
  if (texture) material.map = texture;

  let mesh;
  let rootBones = [];

  if (hasSkeleton) {
    const worldPositions = skeletonWorldPositions(parsed.skeleton, parsed.vertices);
    const bones = parsed.skeleton.map((bone, i) => {
      const b = new THREE.Bone();
      b.name = bone.name || `bone_${i}`;
      return b;
    });
    parsed.skeleton.forEach((bone, i) => {
      const parentIndex = bone.parentIndex;
      const world = worldPositions[i] || [0, 0, 0];
      if (parentIndex >= 0 && bones[parentIndex]) {
        const parentWorld = worldPositions[parentIndex] || [0, 0, 0];
        bones[i].position.set(world[0] - parentWorld[0], world[1] - parentWorld[1], world[2] - parentWorld[2]);
        bones[parentIndex].add(bones[i]);
      } else {
        bones[i].position.set(world[0], world[1], world[2]);
        rootBones.push(bones[i]);
      }
    });
    for (const root of rootBones) {
      root.updateMatrixWorld(true);
      scene.add(root);
    }

    const { skinIndex, skinWeight } = buildSkinAttributes(parsed.boneWeights || [], vertexCount);
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));

    mesh = new THREE.SkinnedMesh(geometry, material);
    const skeletonObj = new THREE.Skeleton(bones);
    scene.add(mesh);
    mesh.bind(skeletonObj);
  } else {
    mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
  }

  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(scene, { binary: true });
  return result;
}

// Combines several independent pieces (e.g. an Avatar Maker selection) into
// a single .glb. Sky's wearable pieces (Body/Cape/Face/Feet/Hair/Hat/Horn/
// Mask/Neck) all skin to the SAME 124-bone avatar rig — identical bone
// names, hierarchy, and bind matrices file-to-file (verified against the
// live data, not assumed) — so one shared THREE.Skeleton is built once and
// every skinned piece's own per-vertex bone weights bind straight to it,
// same bone index space, no remapping needed. Pieces with no skeleton
// (static Props, or a piece that failed to parse its skeleton) fall back to
// a plain unskinned Mesh, same as the single-mesh exportMeshToGlb above.
export async function exportMeshesToGlb(meshes) {
  const scene = new THREE.Scene();
  const material = new THREE.MeshStandardMaterial({ color: '#dbe7f5', metalness: 0.1, roughness: 0.55 });

  const skinned = meshes.filter((m) => m?.skeleton?.length > 0 && m?.boneWeights);
  let sharedSkeleton = null;

  if (skinned.length) {
    // Every piece carries its own copy of the skeleton, but they're all the
    // same rig (byte-identical bind matrices) — any one's bone list/hierarchy
    // works as the reference. Only the flip (see decideSkeletonFlip) needs
    // votes from all of them.
    const referenceSkeleton = skinned[0].skeleton;
    const bindPositions = referenceSkeleton.map((bone) => matrixPosition(bone.invBindMatrix));
    const flip = decideSkeletonFlip(skinned, bindPositions);
    const worldPositions = flip ? bindPositions.map(([x, y, z]) => [-x, y, -z]) : bindPositions;
    const bones = referenceSkeleton.map((bone, i) => {
      const b = new THREE.Bone();
      b.name = bone.name || `bone_${i}`;
      return b;
    });
    const rootBones = [];
    referenceSkeleton.forEach((bone, i) => {
      const parentIndex = bone.parentIndex;
      const world = worldPositions[i] || [0, 0, 0];
      if (parentIndex >= 0 && bones[parentIndex]) {
        const parentWorld = worldPositions[parentIndex] || [0, 0, 0];
        bones[i].position.set(world[0] - parentWorld[0], world[1] - parentWorld[1], world[2] - parentWorld[2]);
        bones[parentIndex].add(bones[i]);
      } else {
        bones[i].position.set(world[0], world[1], world[2]);
        rootBones.push(bones[i]);
      }
    });
    for (const root of rootBones) {
      root.updateMatrixWorld(true);
      scene.add(root);
    }
    sharedSkeleton = new THREE.Skeleton(bones);
  }

  for (const m of meshes) {
    if (!m || !m.positions || !m.indices) continue;
    const vertexCount = m.positions.length / 3;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(Float32Array.from(m.positions), 3));
    if (m.uvs?.length === vertexCount * 2) {
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(Float32Array.from(m.uvs), 2));
    }
    geometry.setIndex(Array.from(m.indices));
    if (m.normals?.length === vertexCount * 3) {
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(Float32Array.from(m.normals), 3));
    } else {
      geometry.computeVertexNormals();
    }

    if (sharedSkeleton && m.skeleton?.length > 0 && m.boneWeights) {
      const { skinIndex, skinWeight } = buildSkinAttributes(m.boneWeights, vertexCount);
      geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
      geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
      const skinnedMesh = new THREE.SkinnedMesh(geometry, material);
      scene.add(skinnedMesh);
      skinnedMesh.bind(sharedSkeleton);
    } else {
      scene.add(new THREE.Mesh(geometry, material));
    }
  }

  const exporter = new GLTFExporter();
  return exporter.parseAsync(scene, { binary: true });
}
