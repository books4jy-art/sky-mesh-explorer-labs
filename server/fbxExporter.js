// FBX export via a local Blender install, ported from ThatMeshStudio (SCOTL)'s
// src/fbxExporter.js and simplified for a single mesh (no avatar-layering,
// no height shape keys — this app has neither concept).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

export function findBlender() {
  const candidates = [
    process.env.BLENDER_EXE,
    'C:\\Program Files\\Blender Foundation\\Blender 4.5\\blender.exe',
    'C:\\Program Files\\Blender Foundation\\Blender 4.4\\blender.exe',
    'C:\\Program Files\\Blender Foundation\\Blender 4.3\\blender.exe',
    'C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender.exe',
    '/Applications/Blender.app/Contents/MacOS/Blender',
    '/opt/homebrew/bin/blender',
    '/usr/local/bin/blender',
    '/usr/bin/blender',
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function invert4(a) {
  const m = Array.from({ length: 4 }, (_, row) => Array.from({ length: 4 }, (_, col) => a[col * 4 + row]));
  const aug = m.map((row, i) => row.concat([0, 0, 0, 0].map((_, j) => i === j ? 1 : 0)));
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

// Bone head positions come from each bone's inverse bind matrix. Whether that
// puts the skeleton in front of or behind the mesh along Z depends on the
// exporter that produced the .mesh file, so pick whichever orientation lands
// the skeleton's bbox center closer to the mesh's — same heuristic SCOTL uses.
function skeletonPositions(skeleton, vertices) {
  const positions = (skeleton || []).map((bone) => matrixPosition(bone.invBindMatrix));
  if (!positions.length || !vertices?.length) return positions;
  const meshCenter = bboxCenter(vertices), skeletonCenter = bboxCenter(positions.flat());
  return Math.abs(-skeletonCenter[2] - meshCenter[2]) + 0.08 < Math.abs(skeletonCenter[2] - meshCenter[2])
    ? positions.map(([x, y, z]) => [-x, y, -z]) : positions;
}

function blenderScript() {
  return String.raw`
import json
import os
import re
import sys
import bpy
from mathutils import Vector

json_path = sys.argv[sys.argv.index("--") + 1]
out_path = sys.argv[sys.argv.index("--") + 2]
with open(json_path, "r", encoding="utf-8") as f:
    data = json.load(f)

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()

def unique_name(value, fallback):
    clean = re.sub(r"[^A-Za-z0-9_. -]+", "_", value or fallback).strip()
    return clean[:60] or fallback

name = unique_name(data.get("modelName") or data.get("fileName"), "Mesh")
mesh = bpy.data.meshes.new(name)
vertices = [tuple(data["vertices"][i:i+3]) for i in range(0, len(data.get("vertices") or []), 3)]
faces = [tuple(data["indices"][i:i+3]) for i in range(0, len(data.get("indices") or []), 3)]
mesh.from_pydata(vertices, [], faces)
mesh.update()
for poly in mesh.polygons:
    poly.use_smooth = True

custom_normals = [tuple(data["normals"][i:i+3]) for i in range(0, len(data.get("normals") or []), 3)]
if len(custom_normals) == len(vertices) and hasattr(mesh, "normals_split_custom_set_from_vertices"):
    mesh.normals_split_custom_set_from_vertices(custom_normals)

obj = bpy.data.objects.new(name, mesh)
bpy.context.collection.objects.link(obj)
created = [obj]

uvs = data.get("uvs") or []
if uvs:
    uv_layer = mesh.uv_layers.new(name=data.get("primaryUvSet") or "UVMap")
    for poly in mesh.polygons:
        for loop_index in poly.loop_indices:
            vertex_index = mesh.loops[loop_index].vertex_index
            offset = vertex_index * 2
            if offset + 1 < len(uvs):
                uv_layer.data[loop_index].uv = (uvs[offset], 1.0 - uvs[offset + 1])

texture_path = data.get("texturePngPath")
if texture_path and os.path.exists(texture_path):
    material = bpy.data.materials.new(name + "_Material")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    principled = nodes.get("Principled BSDF")
    image = bpy.data.images.load(texture_path, check_existing=True)
    node = nodes.new("ShaderNodeTexImage")
    node.image = image
    node.location = (-320, 260)
    if principled:
        links.new(node.outputs["Color"], principled.inputs["Base Color"])
    mesh.materials.append(material)

bones = data.get("skeleton") or []
positions = data.get("bonePositions") or []
if bones and len(positions) >= len(bones):
    arm = bpy.data.armatures.new(name + "_Rig")
    arm_obj = bpy.data.objects.new(name + "_Rig", arm)
    bpy.context.collection.objects.link(arm_obj)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = arm_obj
    arm_obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    children = {}
    for i, bone in enumerate(bones):
        parent = int(bone.get("parentIndex", -1))
        if parent >= 0:
            children.setdefault(parent, []).append(i)
    edit_bones = []
    for i, bone in enumerate(bones):
        bone_name = unique_name(bone.get("name"), "bone_" + str(i))
        edit = arm.edit_bones.new(bone_name)
        head = Vector(positions[i])
        if children.get(i):
            tail = sum((Vector(positions[c]) for c in children[i]), Vector()) / len(children[i])
        else:
            tail = head + Vector((0, 0.05, 0))
        if (tail - head).length < 0.01:
            tail = head + Vector((0, 0.05, 0))
        edit.head, edit.tail = head, tail
        edit_bones.append(edit)
    for i, bone in enumerate(bones):
        parent = int(bone.get("parentIndex", -1))
        if 0 <= parent < len(edit_bones):
            edit_bones[i].parent = edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    obj.parent = arm_obj
    modifier = obj.modifiers.new("Armature", "ARMATURE")
    modifier.object = arm_obj
    groups = [obj.vertex_groups.new(name=unique_name(bones[i].get("name"), "bone_" + str(i))) for i in range(len(bones))]
    for vertex_index, weights in enumerate(data.get("boneWeights") or []):
        for bone_index, weight in weights:
            if 0 <= bone_index < len(groups) and float(weight) > 0:
                groups[bone_index].add([vertex_index], float(weight), "ADD")
    created.append(arm_obj)

bpy.ops.object.select_all(action="DESELECT")
for o in created:
    o.select_set(True)
bpy.context.view_layer.objects.active = created[0]

bpy.ops.export_scene.fbx(
    filepath=out_path,
    use_selection=True,
    object_types={"MESH", "ARMATURE"},
    add_leaf_bones=False,
    bake_anim=False,
    mesh_smooth_type="FACE",
    path_mode="COPY",
    embed_textures=True,
)
`;
}

function runBlender(blenderPath, scriptPath, jsonPath, outPath) {
  return new Promise((resolve, reject) => {
    execFile(blenderPath, ['--background', '--factory-startup', '--python', scriptPath, '--', jsonPath, outPath],
      { timeout: 120000, windowsHide: true }, (error, stdout, stderr) => {
        if (error) reject(new Error(stderr || stdout || error.message));
        else resolve({ stdout, stderr });
      });
  });
}

// payload: { fileName, modelName, vertices, normals, indices, uvs, primaryUvSet,
//            skeleton, boneWeights, texturePngPath }
export async function exportMeshToFbx(payload, outPath) {
  const blenderPath = findBlender();
  if (!blenderPath) throw new Error('Blender was not found on this server. Install Blender or set BLENDER_EXE.');

  const bonePositions = skeletonPositions(payload.skeleton, payload.vertices);
  const scenePayload = { ...payload, bonePositions };

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sme-fbx-'));
  const jsonPath = path.join(tmpDir, 'scene.json');
  const scriptPath = path.join(tmpDir, 'export_fbx.py');
  fs.writeFileSync(jsonPath, JSON.stringify(scenePayload), 'utf8');
  fs.writeFileSync(scriptPath, blenderScript(), 'utf8');
  try {
    const result = await runBlender(blenderPath, scriptPath, jsonPath, outPath);
    if (!fs.existsSync(outPath)) {
      const detail = `${result.stderr || ''}\n${result.stdout || ''}`.trim().slice(-1600);
      throw new Error(`Blender finished without creating the FBX file.${detail ? `\n${detail}` : ''}`);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
