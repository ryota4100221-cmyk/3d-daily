# Day 110 — 白い外壁の模型を組む（engine/bake で光を焼く）
#   Blender -b --factory-startup -P days/110_arbor/blender/build.py -- days/110_arbor/blender/scene.blend
# 座標：ref.png の画面 px（X, Y）を z=0 の面で 100 px = 1 m に写す。Blender x = (X-720)/100, z = (450-Y)/100、手前が −y
import bpy, math, sys, os, json
argv = sys.argv[sys.argv.index('--') + 1:]
HERE = os.path.dirname(os.path.abspath(__file__))
F = json.load(open(os.path.join(HERE, 'facade.json')))
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene

T = 0.62          # 外壁の厚み（見込み）
BACK = 1.1        # 穴の奥の壁
ATR = 1.0         # アトリウムの奥
FLOOR = (450 - 765) / 100 - 0.0

def wx(X): return (X - 720) / 100
def wz(Y): return (450 - Y) / 100

def mat(name, rgb, rough=0.85):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Roughness'].default_value = rough
    return m

clay = mat('clay', (0.80, 0.785, 0.76))
paper = mat('paper', (0.9, 0.875, 0.84))

def fillet(poly, r, grow=0):
    """多角形の角を半径 r の円弧で丸めた点列（画面 px → m）"""
    if grow:
        cx = sum(p[0] for p in poly) / len(poly); cy = sum(p[1] for p in poly) / len(poly)
        poly = [(x + (x - cx) * grow / math.hypot(x - cx, y - cy), y + (y - cy) * grow / math.hypot(x - cx, y - cy)) for x, y in poly]
    P = [(wx(x), wz(y)) for x, y in poly]
    n = len(P); out = []
    for i in range(n):
        p0, p1, p2 = P[i - 1], P[i], P[(i + 1) % n]
        a = (p0[0] - p1[0], p0[1] - p1[1]); b = (p2[0] - p1[0], p2[1] - p1[1])
        la, lb = math.hypot(*a), math.hypot(*b)
        a = (a[0] / la, a[1] / la); b = (b[0] / lb, b[1] / lb)
        cosang = max(-1, min(1, a[0] * b[0] + a[1] * b[1])); ang = math.acos(cosang)
        rr = min(r, 0.45 * min(la, lb) * math.tan(ang / 2))
        d = rr / math.tan(ang / 2)
        s = (p1[0] + a[0] * d, p1[1] + a[1] * d); e = (p1[0] + b[0] * d, p1[1] + b[1] * d)
        bis = (a[0] + b[0], a[1] + b[1]); lbis = math.hypot(*bis)
        c = (p1[0] + bis[0] / lbis * rr / math.sin(ang / 2), p1[1] + bis[1] / lbis * rr / math.sin(ang / 2))
        a0 = math.atan2(s[1] - c[1], s[0] - c[0]); a1 = math.atan2(e[1] - c[1], e[0] - c[0])
        da = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi
        for k in range(7):
            t = a0 + da * k / 6
            out.append((c[0] + rr * math.cos(t), c[1] + rr * math.sin(t)))
    return out

def rect(x0, y0, x1, y1): return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]

def slab(name, box, holes, outline=None):
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '2D'; cu.fill_mode = 'BOTH'
    cu.extrude = T / 2 - 0.02; cu.bevel_depth = 0.02; cu.bevel_resolution = 2
    for poly, r, gw in [(outline or rect(*box), 0.04, 0)] + [(h, F['radius'] / 100, F.get('grow', 0)) for h in holes]:
        pts = fillet(poly, r, gw)
        sp = cu.splines.new('POLY'); sp.points.add(len(pts) - 1)
        for i, (x, y) in enumerate(pts): sp.points[i].co = (x, y, 0, 1)
        sp.use_cyclic_u = True
    o = bpy.data.objects.new(name, cu); sc.collection.objects.link(o)
    o.rotation_euler = (math.radians(90), 0, 0); o.location = (0, T / 2, 0)
    bpy.context.view_layer.objects.active = o; o.select_set(True)
    bpy.ops.object.convert(target='MESH'); o = bpy.context.active_object
    o.data.materials.clear(); o.data.materials.append(clay)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35)) if hasattr(bpy.ops.object, 'shade_smooth_by_angle') else None
    o.select_set(False)
    return o

for k in ('L', 'R'):
    slab('slab' + k, F['slabs'][k], F['holes'][k], F.get('outline', {}).get(k))
# 左の板の下が切れた所の奥に、もう1枚の板（段違い）

def box(name, m, x0, x1, y0, y1, z0, z1):
    bpy.ops.mesh.primitive_cube_add(size=1, location=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
    o = bpy.context.active_object; o.name = name; o.scale = (x1 - x0, y1 - y0, z1 - z0)
    bpy.ops.object.transform_apply(scale=True); o.data.materials.append(m); return o

top, bot = wz(225), wz(765)
xl, xr = wx(535), wx(925)
# 穴の奥の壁（左右）とアトリウムの奥、アトリウムの両側の返し
box('backL', paper, wx(-200), xl, BACK, BACK + 0.1, bot - 0.2, top)
box('backR', paper, xr, wx(1650), BACK, BACK + 0.1, bot - 0.2, top)
box('atrium', paper, xl - 0.1, xr + 0.1, ATR, ATR + 0.1, bot - 0.2, top + 0.2)
box('returnL', clay, xl - 0.08, xl, T - 0.01, ATR, bot, top)
box('returnR', clay, xr, xr + 0.08, T - 0.01, ATR, bot, top)
# 階の床（穴の奥に見える室内の段）
for i, Y in enumerate(()):
    box(f'floorL{i}', paper, wx(-200), xl, T, BACK, wz(Y) - 0.04, wz(Y))
    box(f'floorR{i}', paper, xr, wx(1650), T, BACK, wz(Y) - 0.04, wz(Y))
# 左下の奥の板（ref の x≈190 で前の板が切れ、奥の板が覗く）
box('slabBack', clay, wx(-200), wx(200), 0.9, 0.9 + T, wz(780), wz(667) - 0.05)
# 地面
box('ground', paper, -14, 14, -9, 4, bot - 0.55, bot - 0.45)

# 庇：浅い弧の殻（円柱の一部）。両端は外壁の天端に載る
c = F['canopy']; x0, x1 = wx(c['x0']), wx(c['x1']); s = wz(c['yTop']) - wz(c['yEnd'])
chord = x1 - x0; R = (chord ** 2 / 4 + s ** 2) / (2 * s); cz = wz(c['yTop']) - R; cx = (x0 + x1) / 2
half = math.asin(chord / 2 / R)
import bmesh
me = bpy.data.meshes.new('canopy'); bm = bmesh.new()
N = 64; th = 0.055; rows = []
for yy in (-0.12, ATR + 0.1):
    ring = []
    for i in range(N + 1):
        a = -half + 2 * half * i / N
        for rad in (R, R - th):
            ring.append(bm.verts.new((cx + rad * math.sin(a), yy, cz + rad * math.cos(a))))
    rows.append(ring)
f0, f1 = rows
for i in range(N):
    o_, n_ = 2 * i, 2 * i + 2
    bm.faces.new((f0[o_], f0[n_], f1[n_], f1[o_]))            # 上面
    bm.faces.new((f0[o_ + 1], f1[o_ + 1], f1[n_ + 1], f0[n_ + 1]))  # 下面
    bm.faces.new((f0[o_], f0[o_ + 1], f0[n_ + 1], f0[n_]))    # 手前の小口
    bm.faces.new((f1[o_], f1[n_], f1[n_ + 1], f1[o_ + 1]))    # 奥の小口
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.to_mesh(me); bm.free()
can = bpy.data.objects.new('canopy', me); sc.collection.objects.link(can); me.materials.append(clay)

# 光：曇天の空＋左上前からの弱い太陽
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc.collection.objects.link(sun)
sun.data.energy = 1.6; sun.data.angle = math.radians(18)
sun.rotation_euler = (math.radians(38), math.radians(-14), math.radians(-28))
sc['bake_states'] = 'day'
sc['world_day'] = [0.92, 0.93, 0.95, 1.15]
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(argv[0]))
print('SAVED', argv[0])
