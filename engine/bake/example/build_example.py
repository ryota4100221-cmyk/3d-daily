# engine/bake の見本シーン（2026-10-25）。印の付け方の実例＋ラインの通し確認用。日の作品では build.py を毎回白紙から書く
#   Blender -b --factory-startup -P engine/bake/example/build_example.py -- <出力.blend>
import bpy, math, sys, os
argv = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene

def mat(name, rgb, rough=0.7):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Roughness'].default_value = rough
    return m

def add(op, name, m, **kw):
    op(**kw); o = bpy.context.active_object; o.name = name; o.data.materials.append(m); return o

white = mat('plaster', (0.74, 0.75, 0.765), 0.85)
add(bpy.ops.mesh.primitive_plane_add, 'floor', white, size=4)
add(bpy.ops.mesh.primitive_cube_add, 'wall', white, size=1, location=(0, 2, 1.2), scale=(2, 0.06, 1.2))
add(bpy.ops.mesh.primitive_cube_add, 'block', white, size=0.8, location=(-0.6, 0.4, 0.4))
o = add(bpy.ops.mesh.primitive_uv_sphere_add, 'ball', mat('clay', (0.8, 0.45, 0.3)), radius=0.35, location=(0.6, -0.2, 0.35))
o['bake'] = 'vertex'                       # 小物は頂点に焼く
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc.collection.objects.link(sun)
sun.data.energy = 5; sun.rotation_euler = (math.radians(55), 0, math.radians(-35)); sun['state'] = 'day'
bulb = bpy.data.objects.new('bulb', bpy.data.lights.new('bulb', 'POINT')); sc.collection.objects.link(bulb)
bulb.data.energy = 60; bulb.data.color = (1, 0.72, 0.42); bulb.location = (0.2, 0.9, 1.4); bulb['state'] = 'night'
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
sc['bake_states'] = 'day,night'
sc['world_day'] = [0.66, 0.73, 0.84, 0.9]
sc['world_night'] = [0.2, 0.27, 0.45, 0.03]
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(argv[0]))
print('SAVED', argv[0])
