# 焼く前の形の確認用：ref と同じ画角で Cycles の素描き（公開しない）
import bpy, math, sys
out = sys.argv[sys.argv.index('--') + 1]
sc = bpy.context.scene
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam)
cam.data.sensor_fit = 'VERTICAL'; cam.data.angle = math.radians(28)
cam.location = (0, -18.05, 0); cam.rotation_euler = (math.radians(90), 0, 0)
sc.camera = cam
sc.render.engine = 'CYCLES'; sc.cycles.samples = 24; sc.cycles.device = 'GPU'
sc.render.resolution_x, sc.render.resolution_y = 1440, 900
sc.render.film_transparent = False
sc.view_settings.view_transform = 'Standard'
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
