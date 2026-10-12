"""Run only with isolated Blender --background --factory-startup --disable-autoexec.
Renders views for manual orientation inspection; does not touch a live scene.
"""
import argparse
import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def options() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--size', type=int, default=768)
    parser.add_argument('--views', default='front,right,back,left')
    return parser.parse_args(sys.argv[sys.argv.index('--') + 1:])


def configure_materials(objects: list[bpy.types.Object]) -> None:
    for obj in objects:
        for material in obj.data.materials:
            if material is None or material.node_tree is None:
                continue
            image = next((node for node in material.node_tree.nodes
                          if node.type == 'TEX_IMAGE' and node.image is not None), None)
            if image is not None:
                material.node_tree.nodes.active = image


def configure_scene(size: int) -> bpy.types.Scene:
    scene = bpy.context.scene
    engines = [item.identifier for item in scene.render.bl_rna.properties['engine'].enum_items]
    # Engines can under-report their identifiers in background mode; assignment is definitive.
    try:
        scene.render.engine = 'BLENDER_WORKBENCH'
    except TypeError as error:
        raise RuntimeError(f'Workbench is unavailable; reported engines: {engines}') from error
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    image = scene.render.image_settings
    formats = [item.identifier for item in image.bl_rna.properties['file_format'].enum_items]
    if 'PNG' not in formats:
        raise RuntimeError('PNG image output is unavailable')
    image.file_format = 'PNG'
    image.color_mode = 'RGBA'
    scene.display.shading.color_type = 'TEXTURE'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = 'BOTH'
    scene.display.shading.show_object_outline = True
    scene.display.shading.object_outline_color = (0.07, 0.055, 0.10)
    if hasattr(scene, 'compositing_node_group'):
        scene.compositing_node_group = None
    return scene


def main() -> None:
    args = options()
    if not 128 <= args.size <= 2048:
        raise ValueError('Render size must be between 128 and 2048')
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=False)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(Path(args.input).resolve()))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    if not meshes:
        raise ValueError('GLB contains no mesh objects')
    configure_materials(meshes)
    corners = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
    minimum = Vector(tuple(min(point[axis] for point in corners) for axis in range(3)))
    maximum = Vector(tuple(max(point[axis] for point in corners) for axis in range(3)))
    center = (minimum + maximum) * 0.5
    extent = maximum - minimum
    scene = configure_scene(args.size)
    camera_data = bpy.data.cameras.new('OfflineAssetCamera')
    camera = bpy.data.objects.new('OfflineAssetCamera', camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera.data.type = 'ORTHO'
    radius = max(extent) * 3
    directions = {'front': (0, -1, 0.025), 'right': (1, 0, 0.025),
                  'back': (0, 1, 0.025), 'left': (-1, 0, 0.025)}
    for view in args.views.split(','):
        if view not in directions:
            raise ValueError(f'Unsupported view: {view}')
        direction = Vector(directions[view]).normalized()
        camera.location = center + direction * radius
        camera.rotation_euler = (center - camera.location).to_track_quat('-Z', 'Y').to_euler()
        horizontal = extent.x if view in ('front', 'back') else extent.y
        camera.data.ortho_scale = max(horizontal, extent.z) * 1.10
        camera.data.clip_start = max(radius / 1000, 0.001)
        camera.data.clip_end = radius * 4
        scene.render.filepath = str(output / f'{view}.png')
        bpy.ops.render.render(write_still=True)
    (output / 'render.json').write_text(json.dumps({
        'input': f'assets/meshy/{Path(args.input).parent.name}/{Path(args.input).name}', 'blender': bpy.app.version_string,
        'engine': scene.render.engine, 'size': args.size, 'views': args.views.split(','),
        'bounds_min': list(minimum), 'bounds_max': list(maximum),
        'camera': 'orthographic', 'background': 'transparent',
    }, indent=2), encoding='utf8')


if __name__ == '__main__':
    main()
