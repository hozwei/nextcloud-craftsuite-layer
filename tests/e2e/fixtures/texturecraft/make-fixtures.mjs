// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Writes the TextureCraft fixture. It is committed; run this only to change it:
//   node tests/e2e/fixtures/texturecraft/make-fixtures.mjs
//
// craftsuite-probe.tcraft  a TextureCraft project as its web build saves one: a zip with
//                          project.json (deflated), the project as JSON. It is named
//                          'craftsuite-probe' (the file's stem), paints the built-in material
//                          ball at 256 x 256 and has one paint layer per texture set: MARKER on
//                          'Ball', 'Base paint' on 'Base'. No painted pixels, no baked maps, no
//                          stored mesh: TextureCraft opens it with blank layers.
//
// The fields and values are those TextureCraft 0.5.0 writes for its sample project
// (crates/core/src/lib.rs Project, crates/formats/src/project_file/mod.rs at v0.5.0), with its
// smart-material layers left out.

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MARKER = 'CRAFTSUITE-PROBE-tx01';

const project = {
  format_version: 2,
  name: "craftsuite-probe",
  mesh: "builtin:material_ball",
  normal_format: "OpenGl",
  texture_sets: [
    {
      name: "Ball",
      description: "",
      material: 0,
      resolution: 256,
      channels: [["BaseColor", "Srgb8"], ["Metallic", "L8"], ["Roughness", "L8"], ["Normal", "Rgb16F"], ["Height", "L16F"]],
      stack: [1],
      normal_mixing: "Combine",
      ao_mixing: "Multiply",
      height_strength: 1.0,
      bake: {"common": {"is_enabled": true, "resolution": "R128", "resolution_height": null, "antialiasing": "None", "dilation": 1, "apply_diffusion": true}, "high_poly": {"use_low_as_high": true, "ignore_backface": true, "match_mode": "Always", "low_suffix": "_low", "high_suffix": "_high", "ignore_backface_suffix": "_ignorebf"}, "cage": {"kind": "DistanceBased", "max_frontal": 0.01, "max_rear": 0.01, "relative_to_bounding_box": true, "average_normals": true}, "skew": {"method": "MeshNormalsBased", "edge_protection": false, "edge_distance": 0.15, "edge_contrast": 0.5}, "maps": {"normal": {"is_enabled": true, "parameters": null}, "world_normal": {"is_enabled": true, "parameters": null}, "id": {"is_enabled": true, "parameters": {"source": "MaterialColor", "generator": "HueShift"}}, "ao": {"is_enabled": true, "parameters": {"rays": {"rays": 24, "min_distance": 1e-05, "max_distance": 1.0, "relative_to_bounding_box": true, "spread": 180.0, "distribution": "Cosine"}, "ignore_backface": "Never", "self_occlusion": "Always", "attenuation": "Linear", "ground_plane": {"enabled": false, "offset": 0.0}}}, "curvature": {"is_enabled": true, "parameters": {"method": "Mesh", "normal_map": {"details": 0.5, "enable_seams": true, "seams_intensity": 1.0}, "mesh": {"rays": 32, "sampling_radius": 0.001, "relative_to_bounding_box": true, "self_intersection": "Always", "auto_tonemapping": true, "value_min": -1.0, "value_max": 1.0}}}, "position": {"is_enabled": true, "parameters": {"axis": "All", "normalization": "BoundingSphere", "scale": "FullScene"}}, "thickness": {"is_enabled": true, "parameters": {"rays": {"rays": 24, "min_distance": 1e-05, "max_distance": 0.1, "relative_to_bounding_box": true, "spread": 180.0, "distribution": "Cosine"}, "self_occlusion": "Always", "normalization": "RelativeToMinMax"}}, "height": {"is_enabled": false, "parameters": {"normalization": "RelativeToLowMesh", "scaling_divisor": 1.0}}, "bent_normal": {"is_enabled": false, "parameters": {"rays": {"rays": 24, "min_distance": 1e-05, "max_distance": 1.0, "relative_to_bounding_box": true, "spread": 180.0, "distribution": "Cosine"}, "ignore_backface": "Never", "self_occlusion": "Always"}}, "opacity": {"is_enabled": false, "parameters": null}}},
      baked: ["Normal", "WorldNormal", "Id", "AmbientOcclusion", "Curvature", "Position", "Thickness"],
      visible: true,
    },
    {
      name: "Base",
      description: "",
      material: 1,
      resolution: 256,
      channels: [["BaseColor", "Srgb8"], ["Metallic", "L8"], ["Roughness", "L8"], ["Normal", "Rgb16F"], ["Height", "L16F"]],
      stack: [2],
      normal_mixing: "Combine",
      ao_mixing: "Multiply",
      height_strength: 1.0,
      bake: {"common": {"is_enabled": true, "resolution": "R128", "resolution_height": null, "antialiasing": "None", "dilation": 1, "apply_diffusion": true}, "high_poly": {"use_low_as_high": true, "ignore_backface": true, "match_mode": "Always", "low_suffix": "_low", "high_suffix": "_high", "ignore_backface_suffix": "_ignorebf"}, "cage": {"kind": "DistanceBased", "max_frontal": 0.01, "max_rear": 0.01, "relative_to_bounding_box": true, "average_normals": true}, "skew": {"method": "MeshNormalsBased", "edge_protection": false, "edge_distance": 0.15, "edge_contrast": 0.5}, "maps": {"normal": {"is_enabled": true, "parameters": null}, "world_normal": {"is_enabled": true, "parameters": null}, "id": {"is_enabled": true, "parameters": {"source": "MaterialColor", "generator": "HueShift"}}, "ao": {"is_enabled": true, "parameters": {"rays": {"rays": 24, "min_distance": 1e-05, "max_distance": 1.0, "relative_to_bounding_box": true, "spread": 180.0, "distribution": "Cosine"}, "ignore_backface": "Never", "self_occlusion": "Always", "attenuation": "Linear", "ground_plane": {"enabled": false, "offset": 0.0}}}, "curvature": {"is_enabled": true, "parameters": {"method": "Mesh", "normal_map": {"details": 0.5, "enable_seams": true, "seams_intensity": 1.0}, "mesh": {"rays": 32, "sampling_radius": 0.001, "relative_to_bounding_box": true, "self_intersection": "Always", "auto_tonemapping": true, "value_min": -1.0, "value_max": 1.0}}}, "position": {"is_enabled": true, "parameters": {"axis": "All", "normalization": "BoundingSphere", "scale": "FullScene"}}, "thickness": {"is_enabled": true, "parameters": {"rays": {"rays": 24, "min_distance": 1e-05, "max_distance": 0.1, "relative_to_bounding_box": true, "spread": 180.0, "distribution": "Cosine"}, "self_occlusion": "Always", "normalization": "RelativeToMinMax"}}, "height": {"is_enabled": false, "parameters": {"normalization": "RelativeToLowMesh", "scaling_divisor": 1.0}}, "bent_normal": {"is_enabled": false, "parameters": {"rays": {"rays": 24, "min_distance": 1e-05, "max_distance": 1.0, "relative_to_bounding_box": true, "spread": 180.0, "distribution": "Cosine"}, "ignore_backface": "Never", "self_occlusion": "Always"}}, "opacity": {"is_enabled": false, "parameters": null}}},
      baked: ["Normal", "WorldNormal", "Id", "AmbientOcclusion", "Curvature", "Position", "Thickness"],
      visible: true,
    },
  ],
  layers: {
    1: {"id": 1, "name": MARKER, "visible": true, "kind": "Paint", "channels": {"BaseColor": {"mode": "Normal", "opacity": 1.0}, "Metallic": {"mode": "Normal", "opacity": 1.0}, "Roughness": {"mode": "Normal", "opacity": 1.0}, "Normal": {"mode": "Normal", "opacity": 1.0}, "Height": {"mode": "Normal", "opacity": 1.0}}, "mask": null, "content_effects": [], "color_tag": null, "height_mask": {"enabled": false, "contrast": 1.0, "offset": 0.0}, "geometry_mask": null},
    2: {"id": 2, "name": "Base paint", "visible": true, "kind": "Paint", "channels": {"BaseColor": {"mode": "Normal", "opacity": 1.0}, "Metallic": {"mode": "Normal", "opacity": 1.0}, "Roughness": {"mode": "Normal", "opacity": 1.0}, "Normal": {"mode": "Normal", "opacity": 1.0}, "Height": {"mode": "Normal", "opacity": 1.0}}, "mask": null, "content_effects": [], "color_tag": null, "height_mask": {"enabled": false, "contrast": 1.0, "offset": 0.0}, "geometry_mask": null},
  },
  next_id: 3,
  display: {"environment": "Studio Soft", "env_opacity": 0.0, "env_exposure": 0.0, "env_blur": 0.35, "env_rotation": 0.0, "shadows": false, "tone_mapping": "AcesFilmic", "fov": 40.0, "post_effects": false, "bloom": 0.0, "vignette": 0.0, "sharpen": 0.0, "grain": 0.0, "ao_intensity": 0.75, "taa": true, "spec_gloss": false, "parallax": false, "displacement": false, "scatter_color": [1.0, 0.4, 0.25], "scatter_radius": 0.1, "ior": 1.5, "dof": {"enabled": false, "focusDistance": 0.0, "aperture": 0.05}},
  cameras: [],
};

// A fixed time for the zip entry, so the file only changes with its content.
const mtime = new Date(Date.UTC(2026, 10, 11, 12, 0, 0));
const zip = zipSync({ 'project.json': [strToU8(JSON.stringify(project)), { level: 6, mtime }] });
writeFileSync(path.join(here, 'craftsuite-probe.tcraft'), zip);
